import { Check, CircleAlert, Clock3, FolderOpen, Headphones, Music2, Trash2, X } from "lucide-react";
import type { QueueItem } from "../types";
import { formatDuration } from "../lib/format";

interface QueuePanelProps {
  items: QueueItem[];
  processing: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onReveal: (path: string) => void;
  onRemove: (id: string) => void;
  onClear: () => void;
}

const statusLabel: Record<QueueItem["status"], string> = {
  waiting: "Waiting",
  processing: "Separating",
  completed: "Completed",
  failed: "Failed",
};

export function QueuePanel({ items, processing, selectedId, onSelect, onReveal, onRemove, onClear }: QueuePanelProps) {
  return (
    <section className="queue-panel" aria-label="Separation queue">
      <div className="queue-header">
        <div>
          <h3>Queue</h3>
          <span>{items.length === 0 ? "Nothing queued" : `${items.length} item${items.length === 1 ? "" : "s"}`}</span>
        </div>
        {items.length > 0 && !processing && (
          <button className="icon-text-button" onClick={onClear}><Trash2 size={14} /> Clear</button>
        )}
      </div>
      <div className="queue-list">
        {items.length === 0 ? (
          <div className="queue-empty">
            <Music2 size={20} />
            <span>Your tracks will appear here</span>
          </div>
        ) : items.map((item) => (
          <article
            className={`queue-row status-${item.status} ${selectedId === item.id ? "selected" : ""}`}
            key={item.id}
            onClick={() => item.status === "completed" && onSelect(item.id)}
          >
            <div className="file-icon"><Music2 size={17} /></div>
            <div className="queue-file">
              <strong title={item.path}>{item.name}</strong>
              <span>{item.status === "failed" ? item.error : item.path}</span>
              {item.status === "processing" && <div className="row-progress"><i style={{ width: `${item.progress}%` }} /></div>}
            </div>
            <div className="queue-status">
              <span className={`status-pill ${item.status}`}>
                {item.status === "completed" && <Check size={13} />}
                {item.status === "failed" && <CircleAlert size={13} />}
                {item.status === "waiting" && <Clock3 size={13} />}
                {statusLabel[item.status]}
              </span>
              {item.status === "processing" && <small>{Math.round(item.progress)}% · {formatDuration(item.etaSeconds)} left</small>}
              {item.status === "completed" && <small>{formatDuration(item.elapsedSeconds)}</small>}
            </div>
            <div className="queue-row-actions">
              {item.status === "completed" && (
                <>
                  <button
                    className="row-action-button"
                    aria-label={`Preview ${item.name}`}
                    title="Preview results"
                    onClick={(event) => { event.stopPropagation(); onSelect(item.id); }}
                  ><Headphones size={14} /></button>
                  <button
                    className="row-action-button"
                    aria-label={`Show ${item.name} results in folder`}
                    title="Show in folder"
                    onClick={(event) => { event.stopPropagation(); onReveal(item.outputs?.[0] ?? item.path); }}
                  ><FolderOpen size={14} /></button>
                </>
              )}
              {!processing && (
                <button
                  className="remove-button"
                  aria-label={`Remove ${item.name}`}
                  onClick={(event) => { event.stopPropagation(); onRemove(item.id); }}
                ><X size={15} /></button>
              )}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
