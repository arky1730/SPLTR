import { Cpu, FolderOpen, Moon, Sun, Trash2, X, Zap } from "lucide-react";
import type { AppSettings, DeviceInfo, DeviceMode, ModelName, ThemeMode } from "../types";

interface SettingsPanelProps {
  open: boolean;
  settings: AppSettings;
  device: DeviceInfo | null;
  onChange: (next: AppSettings) => void;
  onClose: () => void;
  onChooseFolder: () => void;
  onDeleteModels: () => void;
}

const models: Array<{ id: ModelName; title: string; note: string }> = [
  { id: "htdemucs", title: "HT Demucs", note: "Fast · Recommended" },
  { id: "htdemucs_ft", title: "HT Demucs Fine-tuned", note: "Best quality · Slower" },
  { id: "mdx_extra", title: "MDX Extra", note: "Alternative character" },
];

export function SettingsPanel({ open, settings, device, onChange, onClose, onChooseFolder, onDeleteModels }: SettingsPanelProps) {
  const patch = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => onChange({ ...settings, [key]: value });

  return (
    <aside className={`settings-panel ${open ? "open" : ""}`} aria-hidden={!open}>
      <div className="settings-head"><div><span>Preferences</span><h2>Settings</h2></div><button className="round-button" onClick={onClose}><X size={18} /></button></div>
      <div className="settings-scroll">
        <section className="settings-section">
          <label>AI model</label>
          <div className="option-stack">
            {models.map((model) => (
              <button key={model.id} className={`select-card ${settings.model === model.id ? "selected" : ""}`} onClick={() => patch("model", model.id)}>
                <span><strong>{model.title}</strong><small>{model.note}</small></span><i />
              </button>
            ))}
          </div>
        </section>
        <section className="settings-section">
          <label>Processing device</label>
          <div className="segmented three">
            {(["auto", "cuda", "cpu"] as DeviceMode[]).map((mode) => (
              <button key={mode} className={settings.deviceMode === mode ? "active" : ""} onClick={() => patch("deviceMode", mode)} disabled={mode === "cuda" && device?.cudaAvailable === false}>{mode === "cuda" ? "GPU" : mode[0].toUpperCase() + mode.slice(1)}</button>
            ))}
          </div>
          <div className="detected-device">{device?.type === "cuda" ? <Zap size={15} /> : <Cpu size={15} />}<span><small>Detected</small><strong>{device?.name ?? "Checking hardware…"}</strong></span></div>
        </section>
        <section className="settings-section">
          <label>Output</label>
          <div className="segmented"><button className={settings.outputMode === "source" ? "active" : ""} onClick={() => patch("outputMode", "source")}>Beside source</button><button className={settings.outputMode === "custom" ? "active" : ""} onClick={() => patch("outputMode", "custom")}>Custom folder</button></div>
          {settings.outputMode === "custom" && <button className="folder-field" onClick={onChooseFolder}><FolderOpen size={16} /><span>{settings.outputFolder ?? "Choose a folder"}</span></button>}
          <p className="setting-note">{settings.outputMode === "source" ? "Default · saves beside each original audio file." : "All separated files are saved in the selected folder."}</p>
        </section>
        <section className="settings-section">
          <label>Parallel jobs</label>
          <div className="segmented"><button className={settings.concurrentJobs === 1 ? "active" : ""} onClick={() => patch("concurrentJobs", 1)}>1 · Stable</button><button className={settings.concurrentJobs === 2 ? "active" : ""} onClick={() => patch("concurrentJobs", 2)}>2 · High VRAM</button></div>
          <p className="setting-note">Two jobs can use significantly more GPU memory.</p>
        </section>
        <section className="settings-section">
          <label>Appearance</label>
          <div className="segmented three icon-segment">
            {(["dark", "light", "system"] as ThemeMode[]).map((theme) => <button key={theme} className={settings.theme === theme ? "active" : ""} onClick={() => patch("theme", theme)}>{theme === "dark" ? <Moon size={14} /> : theme === "light" ? <Sun size={14} /> : null}{theme[0].toUpperCase() + theme.slice(1)}</button>)}
          </div>
        </section>
        <section className="settings-section danger-zone">
          <button className="danger-button" onClick={onDeleteModels}><Trash2 size={16} /><span><strong>Delete cached models</strong><small>They will download again when needed</small></span></button>
        </section>
      </div>
    </aside>
  );
}
