import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import type { BackendCommand, BackendEvent, DeviceInfo, QueueItem } from "../types";

const isTauri = (): boolean => "__TAURI_INTERNALS__" in window;

type EventHandler = (event: BackendEvent) => void;

class BackendBridge {
  private handlers = new Set<EventHandler>();
  private unlisten: UnlistenFn[] = [];
  private demoTimers = new Set<number>();

  async start(): Promise<void> {
    if (!isTauri()) {
      window.setTimeout(() => this.emit({
        type: "ready",
        device: { type: "cuda", name: "NVIDIA GeForce RTX 4090", cudaAvailable: true, memoryGb: 24 },
        modelCached: true,
      }), 180);
      return;
    }
    this.unlisten.push(await listen<BackendEvent>("backend-event", ({ payload }) => this.emit(payload)));
    await invoke("backend_start");
  }

  async stop(): Promise<void> {
    this.demoTimers.forEach(window.clearInterval);
    this.demoTimers.clear();
    this.unlisten.forEach((fn) => fn());
    this.unlisten = [];
    if (isTauri()) await invoke("backend_stop");
  }

  subscribe(handler: EventHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  async send(command: BackendCommand): Promise<void> {
    if (isTauri()) {
      await invoke("backend_send", { command });
      return;
    }
    this.runDemoCommand(command);
  }

  async selectFolder(): Promise<string | null> {
    if (!isTauri()) return "C:\\Users\\Creator\\Music\\Separated";
    const { open } = await import("@tauri-apps/plugin-dialog");
    const result = await open({ directory: true, multiple: false, title: "Choose output folder" });
    return typeof result === "string" ? result : null;
  }

  async selectAudio(): Promise<string[]> {
    if (!isTauri()) return ["C:\\Music\\Midnight Drive.wav", "C:\\Music\\Neon Skies.flac"];
    const { open } = await import("@tauri-apps/plugin-dialog");
    const result = await open({
      multiple: true,
      title: "Choose audio files or a folder",
      filters: [{ name: "Audio", extensions: ["mp3", "wav", "flac", "m4a", "aiff", "aif", "ogg"] }],
    });
    return typeof result === "string" ? [result] : result ?? [];
  }

  async revealInFolder(path: string): Promise<void> {
    if (!isTauri()) return;
    await invoke("reveal_in_folder", { path });
  }

  async onPathDrop(handler: (paths: string[]) => void): Promise<UnlistenFn> {
    if (!isTauri()) return () => undefined;
    return getCurrentWebview().onDragDropEvent((event) => {
      if (event.payload.type === "drop") handler(event.payload.paths);
    });
  }

  private emit(event: BackendEvent): void {
    this.handlers.forEach((handler) => handler(event));
  }

  private runDemoCommand(command: BackendCommand): void {
    if (command.type === "scan") {
      const files = command.paths.flatMap((path) => path.includes(".") ? [path] : [`${path}\\demo-track.wav`]);
      window.setTimeout(() => this.emit({ type: "scan_result", requestId: command.requestId, files, rejected: [] }), 200);
    }
    if (command.type === "ensure_model") {
      this.emit({ type: "model_download", model: command.model, state: "completed", progress: 100 });
    }
    if (command.type === "delete_models") {
      window.setTimeout(() => this.emit({ type: "cache_cleared" }), 250);
    }
    if (command.type === "start_queue") this.simulateQueue(command.items);
  }

  private simulateQueue(items: Array<{ id: string; path: string }>): void {
    let index = 0;
    const runNext = (): void => {
      const source = items[index];
      if (!source) {
        this.emit({ type: "queue_complete" });
        return;
      }
      const started = Date.now();
      const timer = window.setInterval(() => {
        const progress = Math.min(100, Math.round((Date.now() - started) / 55));
        const item: QueueItem = {
          ...source,
          name: source.path.split(/[\\/]/).pop() ?? source.path,
          status: progress === 100 ? "completed" : "processing",
          progress,
          elapsedSeconds: (Date.now() - started) / 1000,
          etaSeconds: Math.max(0, (100 - progress) * 0.055),
          outputs: progress === 100 ? ["vocals.wav", "instrumental.wav"] : undefined,
        };
        this.emit({ type: "queue_item", item });
        if (progress === 100) {
          window.clearInterval(timer);
          this.demoTimers.delete(timer);
          index += 1;
          runNext();
        }
      }, 90);
      this.demoTimers.add(timer);
    };
    runNext();
  }
}

export const backend = new BackendBridge();
export type { DeviceInfo };
