import { useEffect, useMemo, useRef, useState } from "react";
import { AudioLines, Check, FolderOutput, Gauge, Play, Settings, ShieldCheck, Square, Zap } from "lucide-react";
import { DropZone } from "./components/DropZone";
import { QueuePanel } from "./components/QueuePanel";
import { ResultPlayer } from "./components/ResultPlayer";
import { SettingsPanel } from "./components/SettingsPanel";
import { VideoAudioExtractor } from "./components/VideoAudioExtractor";
import { DownloadOverlay, type DownloadState } from "./components/DownloadOverlay";
import { backend } from "./lib/backend";
import { fileName, formatDuration, newId } from "./lib/format";
import type { AppSettings, BackendEvent, DeviceInfo, QueueItem } from "./types";

const DEFAULT_SETTINGS: AppSettings = { outputFolder: null, outputMode: "source", model: "htdemucs", deviceMode: "auto", concurrentJobs: 1, theme: "dark" };
const VIDEO_PATH = /\.(mp4|mov|mkv|avi|webm|m4v)$/i;

function loadSettings(): AppSettings {
  try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem("spltr.settings") ?? "{}") as Partial<AppSettings> }; }
  catch { return DEFAULT_SETTINGS; }
}

export default function App() {
  const [settings, setSettings] = useState(loadSettings);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [items, setItems] = useState<QueueItem[]>([]);
  const [device, setDevice] = useState<DeviceInfo | null>(null);
  const [processing, setProcessing] = useState(false);
  const [selectedResultId, setSelectedResultId] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [download, setDownload] = useState<DownloadState>({ visible: false, kind: "model", progress: -1, failed: false });
  const [droppedVideoPath, setDroppedVideoPath] = useState<string | null>(null);
  const pendingScan = useRef(new Map<string, true>());

  const applyEvent = (event: BackendEvent) => {
    if (event.type === "ready") {
      setDevice(event.device); setConnected(true);
      void backend.send({ type: "configure", settings });
      if (!event.modelCached) void backend.send({ type: "ensure_model", model: settings.model });
    } else if (event.type === "device") setDevice(event.device);
    else if (event.type === "scan_result") {
      pendingScan.current.delete(event.requestId);
      setItems((current) => {
        const known = new Set(current.map((item) => item.path.toLowerCase()));
        const added = event.files.filter((path) => !known.has(path.toLowerCase())).map((path): QueueItem => ({ id: newId(), path, name: fileName(path), status: "waiting", progress: 0 }));
        if (added.length === 0 && event.files.length > 0) setNotice("Those files are already in the queue.");
        return [...current, ...added];
      });
      if (event.rejected.length) setNotice(`${event.rejected.length} unsupported item${event.rejected.length === 1 ? " was" : "s were"} skipped.`);
    } else if (event.type === "queue_item") {
      setItems((current) => current.map((item) => item.id === event.item.id ? { ...item, ...event.item } : item));
      if (event.item.status === "completed" && event.item.outputs?.length) setSelectedResultId(event.item.id);
    } else if (event.type === "queue_complete") {
      setProcessing(false); setNotice("All tracks are ready.");
    } else if (event.type === "model_download") {
      setDownload({ visible: event.state !== "completed", kind: "model", model: event.model, progress: event.progress, failed: event.state === "failed", message: event.message });
    } else if (event.type === "runtime_download") {
      setDownload({ visible: event.state !== "completed", kind: "runtime", progress: event.progress, failed: event.state === "failed", message: event.message });
    } else if (event.type === "cache_cleared") setNotice("Cached AI models deleted.");
    else if (event.type === "error") setNotice(event.message);
  };

  useEffect(() => {
    const unsubscribe = backend.subscribe(applyEvent);
    let unlistenDrop: (() => void) | undefined;
    void backend.start().then(() => backend.onPathDrop(routeDroppedPaths)).then((fn) => { unlistenDrop = fn; }).catch((error: unknown) => {
      setNotice(error instanceof Error ? error.message : "Could not start the local AI engine.");
    });
    return () => { unsubscribe(); unlistenDrop?.(); void backend.stop(); };
    // Backend lifecycle should only be bound once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    localStorage.setItem("spltr.settings", JSON.stringify(settings));
    document.documentElement.dataset.theme = settings.theme;
    if (connected) void backend.send({ type: "configure", settings });
  }, [settings, connected]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 4200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  function addPaths(paths: string[]) {
    if (!paths.length) return;
    const requestId = newId();
    pendingScan.current.set(requestId, true);
    void backend.send({ type: "scan", requestId, paths });
  }

  function routeDroppedPaths(paths: string[]) {
    if (paths.length === 1 && VIDEO_PATH.test(paths[0])) {
      setDroppedVideoPath(paths[0]);
      return;
    }
    addPaths(paths);
  }

  async function browse() { addPaths(await backend.selectAudio()); }

  function addBrowserFiles(files: File[]) {
    addPaths(files.map((file) => (file as File & { path?: string }).path ?? file.name));
  }

  function startQueue() {
    const waiting = items.filter((item) => item.status === "waiting" || item.status === "failed");
    if (!waiting.length) return;
    setItems((current) => current.map((item) => item.status === "failed" ? { ...item, status: "waiting", progress: 0, error: undefined } : item));
    setProcessing(true);
    void backend.send({ type: "start_queue", items: waiting.map(({ id, path }) => ({ id, path })) });
  }

  function stopQueue() { void backend.send({ type: "cancel_queue" }); setProcessing(false); }

  async function chooseFolder() {
    const folder = await backend.selectFolder();
    if (folder) setSettings((current) => ({ ...current, outputFolder: folder, outputMode: "custom" }));
  }

  async function revealInFolder(path: string) {
    try {
      await backend.revealInFolder(path);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not open the output folder.");
    }
  }

  async function retryDownload() {
    if (download.kind === "runtime") {
      setDownload((current) => ({ ...current, failed: false, progress: -1, message: "Restarting the local AI engine…" }));
      await backend.stop();
      await backend.start();
    } else {
      await backend.send({ type: "ensure_model", model: settings.model });
    }
  }

  const active = items.find((item) => item.status === "processing");
  const completed = items.filter((item) => item.status === "completed").length;
  const waiting = items.filter((item) => item.status === "waiting").length;
  const overallProgress = items.length ? items.reduce((sum, item) => sum + item.progress, 0) / items.length : 0;
  const elapsed = items.reduce((sum, item) => sum + (item.elapsedSeconds ?? 0), 0);
  const canStart = items.some((item) => item.status === "waiting" || item.status === "failed");
  const outputLabel = settings.outputMode === "source" ? "Beside each source" : settings.outputFolder ?? "Choose output folder";
  const modelLabel = useMemo(() => ({ htdemucs: "HT Demucs", htdemucs_ft: "HT Demucs FT", mdx_extra: "MDX Extra" })[settings.model], [settings.model]);
  const selectedResult = items.find((item) => item.id === selectedResultId && item.status === "completed") ?? null;

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand"><div className="brand-mark"><AudioLines size={22} /></div><div><strong>SPLTR</strong><span>VOCAL SEPARATOR</span></div></div>
        <div className="header-status"><ShieldCheck size={14} /><span>100% local</span><i /><span className={connected ? "online" : ""}>{connected ? "Engine ready" : "Starting engine"}</span></div>
        <button className="settings-button" onClick={() => setSettingsOpen(true)}><Settings size={18} /><span>Settings</span></button>
      </header>

      <main className="workspace">
        <section className="hero-column">
          <div className="intro"><span className="eyebrow">LOCAL AI STEM SEPARATION</span><h1>Split the track.<br /><em>Hear the difference.</em></h1><p>Drop audio, separate locally, and review every stem in one workspace.</p></div>
          <DropZone compact={items.length > 0} disabled={processing} onBrowse={() => void browse()} onBrowserFiles={addBrowserFiles} />
          <div className="quick-settings">
            <button onClick={() => setSettingsOpen(true)}><Zap size={16} /><span><small>Model</small><strong>{modelLabel}</strong></span></button>
            <button onClick={() => setSettingsOpen(true)}><Gauge size={16} /><span><small>Device</small><strong>{device?.type === "cuda" ? device.name.replace("NVIDIA GeForce ", "") : device?.name ?? "Detecting…"}</strong></span></button>
            <button onClick={() => setSettingsOpen(true)}><FolderOutput size={16} /><span><small>Output</small><strong>{outputLabel}</strong></span></button>
          </div>
          <VideoAudioExtractor
            disabled={processing}
            outputLabel={outputLabel}
            droppedPath={droppedVideoPath}
            onDroppedPathConsumed={() => setDroppedVideoPath(null)}
            onNotice={setNotice}
            onReveal={(path) => void revealInFolder(path)}
          />
        </section>

        <section className="queue-column">
          {processing && <div className="overall-card"><div className="overall-top"><div><span className="pulse-dot" /><span>SEPARATING</span><strong>{active?.name ?? "Preparing track"}</strong></div><b>{Math.round(overallProgress)}%</b></div><div className="overall-bar"><i style={{ width: `${overallProgress}%` }} /></div><div className="overall-meta"><span>{completed} complete · {waiting} remaining</span><span>{formatDuration(elapsed)} elapsed{active?.etaSeconds ? ` · ${formatDuration(active.etaSeconds)} current ETA` : ""}</span></div></div>}
          <QueuePanel
            items={items}
            processing={processing}
            selectedId={selectedResultId}
            onSelect={setSelectedResultId}
            onReveal={(path) => void revealInFolder(path)}
            onRemove={(id) => {
              setItems((current) => current.filter((item) => item.id !== id));
              if (selectedResultId === id) setSelectedResultId(null);
            }}
            onClear={() => { setItems([]); setSelectedResultId(null); }}
          />
          <div className="queue-action">
            <div><span>{items.length ? `${completed} of ${items.length} completed` : "Add audio to begin"}</span><small>Creates *_vocals.wav and *_instrumental.wav</small></div>
            {processing ? <button className="stop-button" onClick={stopQueue}><Square size={14} /> Stop</button> : <button className="primary-button" disabled={!canStart} onClick={startQueue}><Play size={16} fill="currentColor" /> Separate {canStart ? `${items.filter((item) => item.status !== "completed").length} track${items.filter((item) => item.status !== "completed").length === 1 ? "" : "s"}` : ""}</button>}
          </div>
          <ResultPlayer item={selectedResult} disabled={processing} onReveal={(path) => void revealInFolder(path)} onNotice={setNotice} />
        </section>
      </main>

      <SettingsPanel open={settingsOpen} settings={settings} device={device} onChange={setSettings} onClose={() => setSettingsOpen(false)} onChooseFolder={() => void chooseFolder()} onDeleteModels={() => void backend.send({ type: "delete_models" })} />
      {settingsOpen && <div className="panel-shade" onClick={() => setSettingsOpen(false)} />}
      <DownloadOverlay state={download} onRetry={() => void retryDownload()} />
      {notice && <div className="toast"><Check size={16} />{notice}</div>}
    </div>
  );
}
