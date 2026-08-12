export const AUDIO_EXTENSIONS = ["mp3", "wav", "flac", "m4a", "aiff", "aif", "ogg"] as const;

export type QueueStatus = "waiting" | "processing" | "completed" | "failed";
export type DeviceMode = "auto" | "cuda" | "cpu";
export type ThemeMode = "dark" | "light" | "system";
export type ModelName = "htdemucs" | "htdemucs_ft" | "mdx_extra";

export interface QueueItem {
  id: string;
  path: string;
  name: string;
  status: QueueStatus;
  progress: number;
  elapsedSeconds?: number;
  etaSeconds?: number;
  error?: string;
  outputs?: string[];
}

export interface AppSettings {
  outputFolder: string | null;
  outputMode: "source" | "custom";
  model: ModelName;
  deviceMode: DeviceMode;
  concurrentJobs: 1 | 2;
  theme: ThemeMode;
}

export interface DeviceInfo {
  type: "cuda" | "cpu";
  name: string;
  cudaAvailable: boolean;
  memoryGb?: number;
}

export type BackendEvent =
  | { type: "ready"; device: DeviceInfo; modelCached: boolean }
  | { type: "device"; device: DeviceInfo }
  | { type: "scan_result"; requestId: string; files: string[]; rejected: string[] }
  | { type: "queue_item"; item: QueueItem }
  | { type: "queue_complete" }
  | { type: "model_download"; model: ModelName; state: "started" | "progress" | "completed" | "failed"; progress: number; message?: string }
  | { type: "runtime_download"; state: "started" | "progress" | "completed" | "failed"; progress: number; message?: string }
  | { type: "waveform"; requestId: string; path: string; peaks: number[]; message?: string }
  | { type: "export_video"; requestId: string; state: "started" | "completed" | "failed"; path?: string; message?: string }
  | { type: "export_audio"; requestId: string; state: "started" | "completed" | "failed"; path?: string; format?: "wav" | "mp3"; message?: string }
  | { type: "extract_video_audio"; requestId: string; state: "started" | "completed" | "failed"; path?: string; format?: "wav" | "mp3"; message?: string }
  | { type: "cache_cleared" }
  | { type: "error"; code: string; message: string; recoverable: boolean };

export type BackendCommand =
  | { type: "configure"; settings: AppSettings }
  | { type: "scan"; requestId: string; paths: string[] }
  | { type: "start_queue"; items: Array<{ id: string; path: string }> }
  | { type: "cancel_queue" }
  | { type: "ensure_model"; model: ModelName }
  | { type: "delete_models" }
  | { type: "waveform"; requestId: string; path: string }
  | { type: "export_video"; requestId: string; path: string; startSeconds: number; endSeconds: number | null; contentDurationSeconds: number; silenceBeforeSeconds: number; silenceAfterSeconds: number; outputDurationSeconds: number; fadeInSeconds: number; fadeOutSeconds: number }
  | { type: "export_audio"; requestId: string; path: string; format: "wav" | "mp3"; startSeconds: number; endSeconds: number | null; contentDurationSeconds: number; silenceBeforeSeconds: number; silenceAfterSeconds: number; outputDurationSeconds: number; fadeInSeconds: number; fadeOutSeconds: number }
  | { type: "extract_video_audio"; requestId: string; path: string; format: "wav" | "mp3" }
  | { type: "shutdown" };
