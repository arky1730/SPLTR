import { convertFileSrc } from "@tauri-apps/api/core";
import {
  AudioWaveform,
  Disc3,
  FolderOpen,
  LoaderCircle,
  Mic2,
  Music2,
  Pause,
  Play,
  RotateCcw,
  Scissors,
  Video,
  Volume2,
} from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { backend } from "../lib/backend";
import { newId } from "../lib/format";
import type { QueueItem } from "../types";

type PreviewTrack = "original" | "vocals" | "instrumental";
type ExportState = "idle" | "exporting" | "completed";

export function formatPlayerTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${Math.floor(seconds % 60).toString().padStart(2, "0")}`;
}

export function parseClipRange(startValue: string, endValue: string, duration: number): { start: number; end: number } | null {
  const start = Number(startValue);
  const end = Number(endValue);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) return null;
  if (duration > 0 && end > duration + 0.25) return null;
  return { start, end };
}

function mediaSource(path: string): string {
  return "__TAURI_INTERNALS__" in window ? convertFileSrc(path) : path;
}

function inputTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0";
  return (Math.round(seconds * 10) / 10).toString();
}

function preciseTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00.0";
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${(seconds % 60).toFixed(1).padStart(4, "0")}`;
}

interface WaveformTimelineProps {
  peaks: number[];
  loading: boolean;
  currentTime: number;
  duration: number;
  onSeek: (seconds: number) => void;
}

function WaveformTimeline({ peaks, loading, currentTime, duration, onSeek }: WaveformTimelineProps) {
  const clipId = `played-${useId().replace(/:/g, "")}`;
  const displayPeaks = peaks.length > 0
    ? peaks
    : Array.from({ length: 96 }, (_, index) => loading ? 0.12 + Math.abs(Math.sin(index * 0.41)) * 0.17 : 0.04);
  const barWidth = 100 / displayPeaks.length;
  const progress = duration > 0 ? Math.min(1, currentTime / duration) : 0;

  const bars = displayPeaks.map((peak, index) => {
    const height = Math.max(2.2, Math.min(29, peak * 29));
    return <rect key={index} x={index * barWidth} y={(32 - height) / 2} width={Math.max(0.12, barWidth * 0.58)} height={height} rx={barWidth * 0.16} />;
  });

  return (
    <div className={`waveform-timeline ${loading ? "loading" : ""}`}>
      <svg viewBox="0 0 100 32" preserveAspectRatio="none" aria-hidden="true">
        <g className="waveform-base">{bars}</g>
        <defs><clipPath id={clipId}><rect x="0" y="0" width={progress * 100} height="32" /></clipPath></defs>
        <g className="waveform-played" clipPath={`url(#${clipId})`}>{bars}</g>
      </svg>
      <input
        type="range"
        min={0}
        max={Math.max(duration, 0)}
        step={0.05}
        value={Math.min(currentTime, duration || 0)}
        onChange={(event) => onSeek(Number(event.target.value))}
        aria-label="Preview position"
      />
    </div>
  );
}

interface ClipRangeEditorProps {
  peaks: number[];
  loading: boolean;
  currentTime: number;
  duration: number;
  start: number;
  end: number;
  startValue: string;
  endValue: string;
  previewing: boolean;
  exporting: boolean;
  disabled: boolean;
  exportedPath: string | null;
  onChange: (start: number, end: number) => void;
  onSeek: (seconds: number) => void;
  onPreview: () => void;
  onReset: () => void;
  onStartInput: (value: string) => void;
  onEndInput: (value: string) => void;
  onExport: () => void;
  onReveal: (path: string) => void;
}

type DragTarget = "start" | "end" | "selection";

function ClipRangeEditor({
  peaks,
  loading,
  currentTime,
  duration,
  start,
  end,
  startValue,
  endValue,
  previewing,
  exporting,
  disabled,
  exportedPath,
  onChange,
  onSeek,
  onPreview,
  onReset,
  onStartInput,
  onEndInput,
  onExport,
  onReveal,
}: ClipRangeEditorProps) {
  const timelineRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ target: DragTarget; originTime: number; start: number; end: number } | null>(null);
  const selectedClipId = `selected-${useId().replace(/:/g, "")}`;
  const displayPeaks = peaks.length > 0
    ? peaks
    : Array.from({ length: 140 }, (_, index) => loading ? 0.14 + Math.abs(Math.sin(index * 0.39)) * 0.2 : 0.04);
  const barWidth = 100 / displayPeaks.length;
  const safeDuration = Math.max(duration, 0);
  const startPercent = safeDuration > 0 ? Math.min(100, Math.max(0, start / safeDuration * 100)) : 0;
  const endPercent = safeDuration > 0 ? Math.min(100, Math.max(startPercent, end / safeDuration * 100)) : 100;
  const playheadPercent = safeDuration > 0 ? Math.min(100, Math.max(0, currentTime / safeDuration * 100)) : 0;
  const selectionDuration = Math.max(0, end - start);

  const bars = displayPeaks.map((peak, index) => {
    const height = Math.max(2.5, Math.min(39, peak * 39));
    return <rect key={index} x={index * barWidth} y={(44 - height) / 2} width={Math.max(0.1, barWidth * 0.58)} height={height} rx={barWidth * 0.14} />;
  });

  function timeAt(clientX: number): number {
    const rect = timelineRef.current?.getBoundingClientRect();
    if (!rect || safeDuration <= 0) return 0;
    return Math.min(safeDuration, Math.max(0, (clientX - rect.left) / rect.width * safeDuration));
  }

  function beginDrag(target: DragTarget, event: ReactPointerEvent<HTMLButtonElement>) {
    if (safeDuration <= 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { target, originTime: timeAt(event.clientX), start, end };
  }

  function continueDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    if (!drag || safeDuration <= 0) return;
    const pointerTime = timeAt(event.clientX);
    if (drag.target === "start") {
      onChange(Math.min(pointerTime, end - 0.1), end);
    } else if (drag.target === "end") {
      onChange(start, Math.max(pointerTime, start + 0.1));
    } else {
      const length = drag.end - drag.start;
      const nextStart = Math.min(safeDuration - length, Math.max(0, drag.start + pointerTime - drag.originTime));
      onChange(nextStart, nextStart + length);
    }
  }

  function endDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    dragRef.current = null;
  }

  function adjustHandle(target: "start" | "end", event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (safeDuration <= 0) return;
    if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
    event.preventDefault();
    const amount = event.shiftKey ? 1 : 0.1;
    const direction = event.key === "ArrowRight" ? 1 : -1;
    if (target === "start") onChange(Math.min(end - 0.1, Math.max(0, start + amount * direction)), end);
    else onChange(start, Math.max(start + 0.1, Math.min(safeDuration, end + amount * direction)));
  }

  function seekFromTimeline(event: ReactPointerEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest("[data-trim-control]")) return;
    onSeek(timeAt(event.clientX));
  }

  return (
    <div className="clip-editor">
      <div className="clip-editor-head">
        <div className="export-label"><Video size={15} /><span><strong>Vocal video clip</strong><small>Drag either edge · drag the middle to move</small></span></div>
        <div className="clip-summary"><span>{preciseTime(start)}</span><i>→</i><span>{preciseTime(end)}</span><strong>{selectionDuration.toFixed(1)} sec</strong></div>
        <button className="reset-clip" onClick={onReset}><RotateCcw size={12} /> Full track</button>
      </div>

      <div className={`clip-range-timeline ${loading ? "loading" : ""}`} ref={timelineRef} onPointerDown={seekFromTimeline}>
        <svg viewBox="0 0 100 44" preserveAspectRatio="none" aria-hidden="true">
          <g className="clip-wave-base">{bars}</g>
          <defs><clipPath id={selectedClipId}><rect x={startPercent} y="0" width={endPercent - startPercent} height="44" /></clipPath></defs>
          <g className="clip-wave-selected" clipPath={`url(#${selectedClipId})`}>{bars}</g>
        </svg>
        <div className="clip-outside clip-outside-left" style={{ width: `${startPercent}%` }} />
        <div className="clip-outside clip-outside-right" style={{ left: `${endPercent}%` }} />
        <button
          type="button"
          className="clip-selection-drag"
          data-trim-control
          aria-label="Move selected clip"
          style={{ left: `${startPercent}%`, width: `${endPercent - startPercent}%` }}
          onPointerDown={(event) => beginDrag("selection", event)}
          onPointerMove={continueDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        />
        <button
          type="button"
          className="clip-handle clip-handle-start"
          data-trim-control
          role="slider"
          aria-label="Trim start"
          aria-valuemin={0}
          aria-valuemax={Math.max(0, end - 0.1)}
          aria-valuenow={start}
          aria-valuetext={preciseTime(start)}
          style={{ left: `${startPercent}%` }}
          onKeyDown={(event) => adjustHandle("start", event)}
          onPointerDown={(event) => beginDrag("start", event)}
          onPointerMove={continueDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        ><i /><span>IN</span></button>
        <button
          type="button"
          className="clip-handle clip-handle-end"
          data-trim-control
          role="slider"
          aria-label="Trim end"
          aria-valuemin={Math.min(safeDuration, start + 0.1)}
          aria-valuemax={safeDuration}
          aria-valuenow={end}
          aria-valuetext={preciseTime(end)}
          style={{ left: `${endPercent}%` }}
          onKeyDown={(event) => adjustHandle("end", event)}
          onPointerDown={(event) => beginDrag("end", event)}
          onPointerMove={continueDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        ><i /><span>OUT</span></button>
        <div className="clip-playhead" style={{ left: `${playheadPercent}%` }} />
      </div>

      <div className="clip-editor-controls">
        <label><span>START SEC</span><input aria-label="Clip start seconds" type="number" min="0" step="0.1" value={startValue} onChange={(event) => onStartInput(event.target.value)} /></label>
        <label><span>END SEC</span><input aria-label="Clip end seconds" type="number" min="0" step="0.1" value={endValue} onChange={(event) => onEndInput(event.target.value)} /></label>
        <button className={`preview-clip ${previewing ? "active" : ""}`} disabled={safeDuration <= 0} onClick={onPreview}>{previewing ? <Pause size={13} /> : <Play size={13} fill="currentColor" />}{previewing ? "Stop preview" : "Preview clip"}</button>
        <span className="video-spec">854×480 · H.264/AAC</span>
        <button className="export-button" disabled={disabled || exporting || safeDuration <= 0} onClick={onExport}>
          {exporting ? <LoaderCircle className="spin" size={14} /> : <Scissors size={14} />}
          {exporting ? "Exporting" : "Export MP4"}
        </button>
        {exportedPath && <button className="export-folder" aria-label="Show exported MP4 in folder" onClick={() => onReveal(exportedPath)}><FolderOpen size={14} /></button>}
      </div>
    </div>
  );
}

interface ResultPlayerProps {
  item: QueueItem | null;
  disabled: boolean;
  onReveal: (path: string) => void;
  onNotice: (message: string) => void;
}

export function ResultPlayer({ item, disabled, onReveal, onNotice }: ResultPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const resumeTimeRef = useRef(0);
  const resumePlaybackRef = useRef(false);
  const waveformRequestRef = useRef("");
  const exportRequestRef = useRef("");
  const clipPreviewRangeRef = useRef<{ start: number; end: number } | null>(null);
  const [track, setTrack] = useState<PreviewTrack>("vocals");
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.85);
  const [audioError, setAudioError] = useState(false);
  const [waveform, setWaveform] = useState<number[]>([]);
  const [waveformLoading, setWaveformLoading] = useState(false);
  const [clipStart, setClipStart] = useState("0");
  const [clipEnd, setClipEnd] = useState("");
  const [clipEdited, setClipEdited] = useState(false);
  const [previewingClip, setPreviewingClip] = useState(false);
  const [exportState, setExportState] = useState<ExportState>("idle");
  const [exportedPath, setExportedPath] = useState<string | null>(null);

  const tracks = useMemo(() => ({
    original: item?.path,
    vocals: item?.outputs?.[0],
    instrumental: item?.outputs?.[1],
  }), [item]);
  const activePath = tracks[track] ?? "";
  const clipRange = parseClipRange(clipStart, clipEnd, duration) ?? { start: 0, end: Math.max(0, duration) };

  useEffect(() => backend.subscribe((event) => {
    if (event.type === "waveform" && event.requestId === waveformRequestRef.current) {
      setWaveform(event.peaks);
      setWaveformLoading(false);
    }
    if (event.type === "export_video" && event.requestId === exportRequestRef.current) {
      if (event.state === "started") setExportState("exporting");
      if (event.state === "completed" && event.path) {
        setExportState("completed");
        setExportedPath(event.path);
        onNotice("480p vocal MP4 is ready.");
      }
      if (event.state === "failed") {
        setExportState("idle");
        onNotice(event.message ?? "Could not export the MP4 file.");
      }
    }
  }), [onNotice]);

  useEffect(() => {
    resumeTimeRef.current = 0;
    resumePlaybackRef.current = false;
    setTrack("vocals");
    setPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setAudioError(false);
    setClipStart("0");
    setClipEnd("");
    setClipEdited(false);
    clipPreviewRangeRef.current = null;
    setPreviewingClip(false);
    setExportState("idle");
    setExportedPath(null);
  }, [item?.id]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const loadMetadata = () => void handleMetadata(audio);
    audio.addEventListener("loadedmetadata", loadMetadata);
    audio.pause();
    audio.load();
    setPlaying(false);
    setCurrentTime(resumeTimeRef.current);
    setDuration(0);
    setAudioError(false);
    if (audio.readyState >= 1) loadMetadata();
    return () => audio.removeEventListener("loadedmetadata", loadMetadata);
    // Metadata is rebound whenever the selected local file changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePath]);

  useEffect(() => {
    setWaveform([]);
    if (!activePath) {
      setWaveformLoading(false);
      return;
    }
    const requestId = newId();
    waveformRequestRef.current = requestId;
    setWaveformLoading(true);
    void backend.send({ type: "waveform", requestId, path: activePath }).catch(() => setWaveformLoading(false));
  }, [activePath]);

  function selectTrack(nextTrack: PreviewTrack) {
    if (nextTrack === track) return;
    const audio = audioRef.current;
    clipPreviewRangeRef.current = null;
    setPreviewingClip(false);
    resumeTimeRef.current = audio?.currentTime ?? currentTime;
    resumePlaybackRef.current = Boolean(audio && !audio.paused);
    setTrack(nextTrack);
  }

  async function handleMetadata(audio: HTMLAudioElement) {
    const nextDuration = audio.duration;
    const resumeAt = Math.min(resumeTimeRef.current, Number.isFinite(nextDuration) ? nextDuration : 0);
    audio.currentTime = resumeAt;
    setDuration(nextDuration);
    setCurrentTime(resumeAt);
    if (!clipEdited && track === "vocals") setClipEnd(inputTime(nextDuration));
    if (resumePlaybackRef.current) {
      resumePlaybackRef.current = false;
      try {
        await audio.play();
      } catch {
        setAudioError(true);
      }
    }
  }

  async function togglePlayback() {
    const audio = audioRef.current;
    if (!audio || !activePath) return;
    if (audio.paused) {
      clipPreviewRangeRef.current = null;
      setPreviewingClip(false);
      try {
        await audio.play();
      } catch {
        setAudioError(true);
      }
    } else {
      audio.pause();
      clipPreviewRangeRef.current = null;
      setPreviewingClip(false);
    }
  }

  function handleTimeUpdate(audio: HTMLAudioElement) {
    const nextTime = audio.currentTime;
    const previewRange = clipPreviewRangeRef.current;
    if (previewRange && nextTime >= previewRange.end) {
      audio.pause();
      audio.currentTime = previewRange.start;
      setCurrentTime(previewRange.start);
      clipPreviewRangeRef.current = null;
      setPreviewingClip(false);
      return;
    }
    setCurrentTime(nextTime);
  }

  function seek(value: number) {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = value;
    setCurrentTime(value);
  }

  function changeVolume(value: number) {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = value;
    setVolume(value);
  }

  function setClipRange(start: number, end: number) {
    const audio = audioRef.current;
    if (previewingClip) audio?.pause();
    clipPreviewRangeRef.current = null;
    setPreviewingClip(false);
    setClipEdited(true);
    setClipStart(inputTime(start));
    setClipEnd(inputTime(end));
  }

  function resetClip() {
    const audio = audioRef.current;
    if (previewingClip) audio?.pause();
    clipPreviewRangeRef.current = null;
    setPreviewingClip(false);
    setClipStart("0");
    setClipEnd(inputTime(duration));
    setClipEdited(false);
  }

  async function previewClip() {
    const range = parseClipRange(clipStart, clipEnd, duration);
    if (!range) {
      onNotice("Choose a valid clip range first.");
      return;
    }
    const audio = audioRef.current;
    if (!audio) return;
    if (previewingClip) {
      audio.pause();
      clipPreviewRangeRef.current = null;
      setPreviewingClip(false);
      return;
    }
    clipPreviewRangeRef.current = range;
    resumeTimeRef.current = range.start;
    setPreviewingClip(true);
    if (track !== "vocals") {
      resumePlaybackRef.current = true;
      setTrack("vocals");
      return;
    }
    audio.currentTime = range.start;
    setCurrentTime(range.start);
    try {
      await audio.play();
    } catch {
      clipPreviewRangeRef.current = null;
      setPreviewingClip(false);
      setAudioError(true);
    }
  }

  function exportVideo() {
    const vocals = tracks.vocals;
    if (!vocals) return;
    const range = parseClipRange(clipStart, clipEnd, duration);
    if (!range) {
      onNotice("Enter a valid start and end time within the track.");
      return;
    }
    const requestId = newId();
    exportRequestRef.current = requestId;
    setExportState("exporting");
    setExportedPath(null);
    void backend.send({
      type: "export_video",
      requestId,
      path: vocals,
      startSeconds: clipEdited ? range.start : 0,
      endSeconds: clipEdited ? range.end : null,
    }).catch(() => {
      setExportState("idle");
      onNotice("Could not start the MP4 export.");
    });
  }

  if (!item || !item.outputs?.length) {
    return (
      <section className="result-player result-player-empty" aria-label="Result preview">
        <div className="result-empty-icon"><AudioWaveform size={22} /></div>
        <div>
          <span className="eyebrow">RESULT MONITOR</span>
          <strong>Preview appears when a track is complete</strong>
          <small>Compare stems, trim by time, and export a 480p vocal video without leaving SPLTR.</small>
        </div>
      </section>
    );
  }

  return (
    <section className="result-player" aria-label={`Preview results for ${item.name}`}>
      <audio
        ref={audioRef}
        src={activePath ? mediaSource(activePath) : undefined}
        preload="metadata"
        onDurationChange={(event) => {
          const nextDuration = event.currentTarget.duration;
          if (!Number.isFinite(nextDuration) || nextDuration <= 0) return;
          setDuration(nextDuration);
          if (!clipEdited && track === "vocals") setClipEnd(inputTime(nextDuration));
        }}
        onTimeUpdate={(event) => handleTimeUpdate(event.currentTarget)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => { setPlaying(false); clipPreviewRangeRef.current = null; setPreviewingClip(false); }}
        onError={() => setAudioError(true)}
      />

      <div className="player-heading">
        <div className="player-cover"><AudioWaveform size={24} /></div>
        <div className="player-title">
          <span className="eyebrow">RESULT MONITOR</span>
          <strong title={item.name}>{item.name}</strong>
          <small>{audioError ? "Preview unavailable. The file may have moved or the format is unsupported." : "A/B the source and separated stems at the same position"}</small>
        </div>
        <button className="reveal-button" onClick={() => onReveal(item.outputs?.[0] ?? item.path)}>
          <FolderOpen size={15} /> Show in folder
        </button>
      </div>

      <div className="track-tabs" role="tablist" aria-label="Preview track">
        <button className={track === "original" ? "active" : ""} role="tab" aria-selected={track === "original"} onClick={() => selectTrack("original")}><Disc3 size={14} /> Original</button>
        <button className={track === "vocals" ? "active" : ""} role="tab" aria-selected={track === "vocals"} onClick={() => selectTrack("vocals")}><Mic2 size={14} /> Vocals</button>
        <button className={track === "instrumental" ? "active" : ""} role="tab" aria-selected={track === "instrumental"} onClick={() => selectTrack("instrumental")}><Music2 size={14} /> Instrumental</button>
      </div>

      <div className="transport">
        <button className="play-button" aria-label={playing ? "Pause preview" : "Play preview"} onClick={() => void togglePlayback()}>
          {playing ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}
        </button>
        <span className="timecode">{formatPlayerTime(currentTime)}</span>
        <WaveformTimeline peaks={waveform} loading={waveformLoading} currentTime={currentTime} duration={duration} onSeek={seek} />
        <span className="timecode">{formatPlayerTime(duration)}</span>
        <Volume2 size={15} className="volume-icon" />
        <input className="volume-slider" type="range" min={0} max={1} step={0.02} value={volume} onChange={(event) => changeVolume(Number(event.target.value))} aria-label="Preview volume" />
      </div>

      <ClipRangeEditor
        peaks={waveform}
        loading={waveformLoading}
        currentTime={currentTime}
        duration={duration}
        start={clipRange.start}
        end={clipRange.end}
        startValue={clipStart}
        endValue={clipEnd}
        previewing={previewingClip}
        exporting={exportState === "exporting"}
        disabled={disabled}
        exportedPath={exportedPath}
        onChange={setClipRange}
        onSeek={seek}
        onPreview={() => void previewClip()}
        onReset={resetClip}
        onStartInput={(value) => { if (previewingClip) audioRef.current?.pause(); clipPreviewRangeRef.current = null; setPreviewingClip(false); setClipEdited(true); setClipStart(value); }}
        onEndInput={(value) => { if (previewingClip) audioRef.current?.pause(); clipPreviewRangeRef.current = null; setPreviewingClip(false); setClipEdited(true); setClipEnd(value); }}
        onExport={exportVideo}
        onReveal={onReveal}
      />
    </section>
  );
}
