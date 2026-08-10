import { FileAudio2, FolderOpen, Plus } from "lucide-react";
import { useState, type DragEvent } from "react";

interface DropZoneProps {
  disabled: boolean;
  compact?: boolean;
  onBrowse: () => void;
  onBrowserFiles: (files: File[]) => void;
}

export function DropZone({ disabled, compact = false, onBrowse, onBrowserFiles }: DropZoneProps) {
  const [active, setActive] = useState(false);

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setActive(false);
    if (!disabled) onBrowserFiles(Array.from(event.dataTransfer.files));
  };

  return (
    <div
      className={`drop-zone ${compact ? "is-compact" : ""} ${active ? "is-active" : ""} ${disabled ? "is-disabled" : ""}`}
      onDragEnter={(event) => { event.preventDefault(); setActive(true); }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={() => setActive(false)}
      onDrop={onDrop}
      role="button"
      tabIndex={0}
      onClick={onBrowse}
      onKeyDown={(event) => event.key === "Enter" && onBrowse()}
      aria-label="Add audio files or folders"
    >
      {compact ? (
        <>
          <div className="compact-drop-icon"><Plus size={16} /></div>
          <div className="compact-drop-copy">
            <strong>{active ? "Drop to add" : "Add more audio"}</strong>
            <small>Files or folders · window-wide drop remains active</small>
          </div>
          <span className="secondary-button">Browse</span>
        </>
      ) : (
        <>
          <div className="drop-art" aria-hidden="true">
            <div className="drop-art-card card-back"><FolderOpen size={26} /></div>
            <div className="drop-art-card card-front"><FileAudio2 size={32} /><Plus className="drop-plus" size={16} /></div>
          </div>
          <h2>{active ? "Drop to add" : "Drop audio here"}</h2>
          <p>Files, batches, or entire folders</p>
          <span className="secondary-button">Browse files</span>
          <span className="format-hint">MP3 · WAV · FLAC · M4A · AIFF · OGG</span>
        </>
      )}
    </div>
  );
}
