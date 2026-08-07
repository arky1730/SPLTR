from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
import logging
from pathlib import Path
import shutil
import sys
import threading
import time
from typing import Any

import torch

from .audio import decodable_audio
from .device import detect_device
from .errors import ProcessingError
from .logging_setup import configure_logging
from .models import DemucsModel, SeparationModel, StemOutputs
from .naming import available_stem_paths
from .protocol import EventWriter, parse_command
from .scanner import scan_paths
from .settings import Settings


class SeparationService:
    def __init__(self, app_data: Path, ffmpeg: Path, writer: EventWriter) -> None:
        self.app_data = app_data
        self.ffmpeg = ffmpeg
        self.writer = writer
        self.models_dir = app_data / "models"
        self.temp_dir = app_data / "temp"
        self.settings = Settings()
        self.cancel = threading.Event()
        self.queue_thread: threading.Thread | None = None
        self.download_thread: threading.Thread | None = None
        self.shutdown = threading.Event()
        self._settings_lock = threading.Lock()
        self.logger = configure_logging(app_data / "logs")

    def start(self) -> None:
        device = detect_device(self.settings.device_mode)
        self.logger.info("Engine ready on %s (%s)", device.name, torch.__version__)
        self.writer.emit(
            "ready",
            device=device.to_protocol(),
            modelCached=self._model_cached(self.settings.model),
        )

    def handle(self, command: dict[str, Any]) -> None:
        kind = command["type"]
        if kind == "configure":
            self.configure(command.get("settings", {}))
        elif kind == "scan":
            self.scan(str(command.get("requestId", "")), command.get("paths", []))
        elif kind == "ensure_model":
            self.ensure_model(str(command.get("model", self.settings.model)))
        elif kind == "start_queue":
            self.start_queue(command.get("items", []))
        elif kind == "cancel_queue":
            self.cancel.set()
            self.logger.info("Queue cancellation requested")
        elif kind == "delete_models":
            self.delete_models()
        elif kind == "shutdown":
            self.cancel.set()
            self.shutdown.set()
        else:
            raise ValueError(f"Unknown command type: {kind}")

    def configure(self, raw: object) -> None:
        if not isinstance(raw, dict):
            raise ValueError("Settings must be an object")
        with self._settings_lock:
            previous = self.settings
            self.settings = self.settings.update(raw)
            current = self.settings
        if previous.device_mode != current.device_mode:
            try:
                device = detect_device(current.device_mode)
            except RuntimeError as exc:
                with self._settings_lock:
                    self.settings = Settings().update({**raw, "deviceMode": "auto"})
                self.writer.emit("error", code="gpu_unavailable", message=str(exc), recoverable=True)
                device = detect_device("auto")
            self.writer.emit("device", device=device.to_protocol())
        if previous.model != current.model and not self._model_cached(current.model):
            self.ensure_model(current.model)

    def scan(self, request_id: str, paths: object) -> None:
        if not isinstance(paths, list) or not all(isinstance(path, str) for path in paths):
            raise ValueError("Scan paths must be a list of strings")
        files, rejected = scan_paths(paths)
        self.writer.emit("scan_result", requestId=request_id, files=files, rejected=rejected)

    def ensure_model(self, model_name: str) -> None:
        if model_name not in {"htdemucs", "htdemucs_ft", "mdx_extra"}:
            raise ValueError(f"Unknown model: {model_name}")
        if self.download_thread and self.download_thread.is_alive():
            return

        def download() -> None:
            self.writer.emit(
                "model_download", model=model_name, state="started", progress=-1,
                message="Downloading the model for local use. This only happens once.",
            )
            try:
                DemucsModel(model_name).ensure_available()
                (self.models_dir / f"{model_name}.ready").write_text("ready\n", encoding="utf-8")
                self.writer.emit("model_download", model=model_name, state="completed", progress=100)
                self.logger.info("Model %s is available", model_name)
            except Exception as exc:
                self.logger.exception("Model download failed")
                self.writer.emit(
                    "model_download", model=model_name, state="failed", progress=-1,
                    message=f"Model download failed: {exc}",
                )

        self.download_thread = threading.Thread(target=download, name="model-download", daemon=True)
        self.download_thread.start()

    def start_queue(self, raw_items: object) -> None:
        if self.queue_thread and self.queue_thread.is_alive():
            self.writer.emit(
                "error", code="queue_busy", message="A separation queue is already running.", recoverable=True
            )
            return
        if self.download_thread and self.download_thread.is_alive():
            self.writer.emit(
                "error", code="model_downloading",
                message="Wait for the selected AI model to finish downloading.", recoverable=True,
            )
            return
        if not isinstance(raw_items, list):
            raise ValueError("Queue items must be a list")
        items: list[dict[str, str]] = []
        for item in raw_items:
            if isinstance(item, dict) and isinstance(item.get("id"), str) and isinstance(item.get("path"), str):
                items.append({"id": item["id"], "path": item["path"]})
        self.cancel.clear()
        self.queue_thread = threading.Thread(
            target=self._run_queue, args=(items,), name="separation-queue", daemon=True
        )
        self.queue_thread.start()

    def _run_queue(self, items: list[dict[str, str]]) -> None:
        with self._settings_lock:
            settings = self.settings
        self.logger.info("Starting %d queue items with %d worker(s)", len(items), settings.concurrent_jobs)
        try:
            device = detect_device(settings.device_mode)
        except RuntimeError as exc:
            self.writer.emit("error", code="gpu_unavailable", message=str(exc), recoverable=True)
            return

        if settings.concurrent_jobs == 1:
            model: SeparationModel = DemucsModel(settings.model)
            for index, item in enumerate(items):
                if self.cancel.is_set():
                    break
                self._process_item(item, model, device.type, len(items) - index - 1)
        else:
            # Separate model instances avoid mutating one Torch module across threads.
            with ThreadPoolExecutor(max_workers=2, thread_name_prefix="separator") as pool:
                futures = [
                    pool.submit(
                        self._process_item, item, DemucsModel(settings.model), device.type,
                        max(0, len(items) - index - 1),
                    )
                    for index, item in enumerate(items)
                ]
                for future in as_completed(futures):
                    try:
                        future.result()
                    except Exception:
                        self.logger.exception("Unexpected worker failure")
        self.writer.emit("queue_complete")
        self.logger.info("Queue finished (cancelled=%s)", self.cancel.is_set())

    def _process_item(
        self,
        item: dict[str, str],
        model: SeparationModel,
        device: str,
        remaining_items: int,
    ) -> None:
        if self.cancel.is_set():
            return
        source = Path(item["path"])
        started = time.monotonic()
        state_lock = threading.Lock()
        state = {"progress": 0.0, "done": False}
        outputs: StemOutputs | None = None

        def emit_item(status: str, progress: float, **extra: object) -> None:
            elapsed = time.monotonic() - started
            eta = max(0.0, elapsed / max(progress, 1.0) * (100.0 - progress)) if progress else None
            payload: dict[str, object] = {
                "id": item["id"], "path": str(source), "name": source.name,
                "status": status, "progress": round(progress, 1),
                "elapsedSeconds": round(elapsed, 1), "etaSeconds": round(eta, 1) if eta is not None else None,
                **extra,
            }
            self.writer.emit("queue_item", item=payload, remainingItems=remaining_items)

        def update_progress(value: float) -> None:
            with state_lock:
                state["progress"] = max(state["progress"], value)
            emit_item("processing", state["progress"])

        def heartbeat() -> None:
            while True:
                time.sleep(1.0)
                with state_lock:
                    if state["done"]:
                        return
                    # apply_model has no stable callback API. Keep time/ETA alive without claiming completion.
                    if 20 <= state["progress"] < 90:
                        state["progress"] = min(90.0, state["progress"] + 0.35)
                    value = state["progress"]
                emit_item("processing", value)

        emit_item("processing", 1)
        monitor = threading.Thread(target=heartbeat, name=f"progress-{item['id'][:8]}", daemon=True)
        monitor.start()
        try:
            if not source.exists():
                raise ProcessingError("file_missing", "The source file no longer exists.")
            with self._settings_lock:
                settings = self.settings
            output_dir = source.parent if settings.output_mode == "source" else settings.output_folder
            if output_dir is None:
                raise ProcessingError("output_missing", "Choose an output folder before separating.")
            output_dir.mkdir(parents=True, exist_ok=True)
            vocals, instrumental = available_stem_paths(source, output_dir)
            outputs = StemOutputs(vocals=vocals, instrumental=instrumental)
            with decodable_audio(source, self.temp_dir, self.ffmpeg) as decoded:
                model.separate(decoded, outputs, device, update_progress)
            if self.cancel.is_set():
                vocals.unlink(missing_ok=True)
                instrumental.unlink(missing_ok=True)
                emit_item("waiting", 0)
            else:
                emit_item(
                    "completed", 100,
                    outputs=[str(vocals), str(instrumental)],
                )
        except ProcessingError as exc:
            if outputs:
                outputs.vocals.unlink(missing_ok=True)
                outputs.instrumental.unlink(missing_ok=True)
            self.logger.warning("%s failed: %s", source, exc, exc_info=True)
            emit_item("failed", state["progress"], error=str(exc), errorCode=exc.code)
        except Exception as exc:
            if outputs:
                outputs.vocals.unlink(missing_ok=True)
                outputs.instrumental.unlink(missing_ok=True)
            self.logger.exception("Unexpected processing error for %s", source)
            emit_item("failed", state["progress"], error=f"Unexpected processing error: {exc}")
        finally:
            with state_lock:
                state["done"] = True
            if device == "cuda":
                torch.cuda.empty_cache()

    def delete_models(self) -> None:
        active = (self.queue_thread and self.queue_thread.is_alive()) or (
            self.download_thread and self.download_thread.is_alive()
        )
        if active:
            self.writer.emit(
                "error", code="engine_busy",
                message="Wait for the current separation or download to finish before deleting models.",
                recoverable=True,
            )
            return
        try:
            if self.models_dir.exists():
                shutil.rmtree(self.models_dir)
            self.models_dir.mkdir(parents=True, exist_ok=True)
            self.writer.emit("cache_cleared")
            self.logger.info("Model cache cleared")
        except OSError as exc:
            self.writer.emit(
                "error", code="cache_delete_failed",
                message=f"Could not delete cached models: {exc}", recoverable=True,
            )

    def _model_cached(self, model_name: str) -> bool:
        return (self.models_dir / f"{model_name}.ready").exists()


def run_service(app_data: Path, ffmpeg: Path) -> None:
    writer = EventWriter()
    service = SeparationService(app_data.resolve(), ffmpeg, writer)
    try:
        service.start()
        for line in sys.stdin:
            try:
                command = parse_command(line)
                service.handle(command)
                if service.shutdown.is_set():
                    break
            except (ValueError, TypeError) as exc:
                service.logger.warning("Bad command: %s", exc)
                writer.emit("error", code="invalid_command", message=str(exc), recoverable=True)
    except Exception as exc:
        logging.getLogger("spltr").exception("Fatal backend error")
        writer.emit(
            "error", code="engine_failed", message=f"The local AI engine stopped: {exc}", recoverable=False
        )
