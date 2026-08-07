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
  private demoAudioUrls = new Map<string, string>();

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
    this.demoAudioUrls.forEach((url) => URL.revokeObjectURL(url));
    this.demoAudioUrls.clear();
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
    if (command.type === "waveform") {
      const peaks = Array.from({ length: 220 }, (_, index) => {
        const envelope = 0.38 + Math.sin(index * 0.071) * 0.22;
        return Math.min(1, Math.abs(Math.sin(index * 0.37)) * envelope + 0.08);
      });
      window.setTimeout(() => this.emit({
        type: "waveform", requestId: command.requestId, path: command.path, peaks,
      }), 260);
    }
    if (command.type === "export_video") {
      this.emit({ type: "export_video", requestId: command.requestId, state: "started" });
      window.setTimeout(() => this.emit({
        type: "export_video",
        requestId: command.requestId,
        state: "completed",
        path: command.path.replace(/\.wav$/i, command.endSeconds === null ? ".mp4" : "_clip.mp4"),
      }), 1200);
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
          outputs: progress === 100 ? [this.getDemoAudioUrl(`${source.id}-vocals`), this.getDemoAudioUrl(`${source.id}-instrumental`)] : undefined,
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

  private getDemoAudioUrl(key: string): string {
    const existing = this.demoAudioUrls.get(key);
    if (existing) return existing;
    const sampleRate = 8000;
    const seconds = 30;
    const sampleCount = sampleRate * seconds;
    const buffer = new ArrayBuffer(44 + sampleCount * 2);
    const view = new DataView(buffer);
    const writeText = (offset: number, value: string) => {
      for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
    };
    writeText(0, "RIFF");
    view.setUint32(4, 36 + sampleCount * 2, true);
    writeText(8, "WAVEfmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeText(36, "data");
    view.setUint32(40, sampleCount * 2, true);
    for (let index = 0; index < sampleCount; index += 1) {
      const envelope = 0.34 + Math.sin(index / sampleRate * 1.7) * 0.14;
      const sample = Math.sin(index / sampleRate * Math.PI * 2 * 220) * envelope;
      view.setInt16(44 + index * 2, Math.round(sample * 32767), true);
    }
    const url = URL.createObjectURL(new Blob([buffer], { type: "audio/wav" }));
    this.demoAudioUrls.set(key, url);
    return url;
  }
}

export const backend = new BackendBridge();
export type { DeviceInfo };
