import { BrainCircuit, CircleAlert, RotateCw } from "lucide-react";
import type { ModelName } from "../types";

export interface DownloadState {
  visible: boolean;
  kind: "runtime" | "model";
  model?: ModelName;
  progress: number;
  failed: boolean;
  message?: string;
}

export function DownloadOverlay({ state, onRetry }: { state: DownloadState; onRetry: () => void }) {
  if (!state.visible) return null;
  const title = state.kind === "runtime" ? "Preparing AI engine" : "Downloading AI model";
  return (
    <div className="modal-shade">
      <div className="download-card">
        <div className={`download-icon ${state.failed ? "failed" : ""}`}>{state.failed ? <CircleAlert size={26} /> : <BrainCircuit size={28} />}</div>
        <span className="eyebrow">ONE-TIME SETUP</span>
        <h2>{state.failed ? "Download interrupted" : title}</h2>
        <p>{state.message ?? (state.kind === "runtime" ? "Installing the local processing engine. Audio never leaves this PC." : `Preparing ${state.model ?? "the selected model"} for local separation.`)}</p>
        {!state.failed && <div className={`download-progress ${state.progress < 0 ? "indeterminate" : ""}`}><i style={state.progress >= 0 ? { width: `${state.progress}%` } : undefined} /></div>}
        {!state.failed && <div className="download-meta"><span>{state.progress < 0 ? "Downloading…" : `${Math.round(state.progress)}%`}</span><span>Stored in AppData</span></div>}
        {state.failed && <button className="primary-button" onClick={onRetry}><RotateCw size={16} /> Retry download</button>}
      </div>
    </div>
  );
}

