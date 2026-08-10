import { convertFileSrc } from "@tauri-apps/api/core";
import {
  AudioWaveform,
  Disc3,
  FileAudio2,
  FolderOpen,
  LoaderCircle,
  Mic2,
  Minus,
  Music2,
  Pause,
  Play,
  Plus,
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
export type WaveformGain = "auto" | 1 | 2 | 4 | 8;
type AudioExportFormat = "wav" | "mp3";
type TimelineZoom = 1 | 2 | 4 | 8 | 16;
type SilenceSeconds = 0 | 0.1 | 0.25 | 0.5 | 1 | 2;
type FadeMilliseconds = 0 | 20 | 50 | 100 | 250;

export function adjustWaveformPeaks(peaks: number[], gain: WaveformGain): number[] {
  return peaks.map((peak) => {
    const safePeak = Math.min(1, Math.max(0, peak));
    if (gain === "auto") return Math.min(1, Math.pow(safePeak, 0.55));
    return Math.min(1, safePeak * gain);
  });
}

export function clipRangeForPreset(start: number, seconds: number, duration: number): { start: number; end: number } {
  const safeDuration = Math.max(0, duration);
  const length = Math.min(Math.max(0.1, seconds), safeDuration);
  const safeStart = Math.min(Math.max(0, start), Math.max(0, safeDuration - length));
  return { start: safeStart, end: safeStart + length };
}

export function formatPlayerTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${Math.floor(seconds % 60).toString().padStart(2, "0")}`;
}

export function parseClipRange(startValue: string, endValue: string, duration: number): { start: number; end: number } | null {
  const start = Number(startValue);
  const end = Number(endValue);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) return null;
  if (duration > 0 && end > duration + 0.02) return null;
  return { start, end };
}

function mediaSource(path: string): string {
  return "__TAURI_INTERNALS__" in window ? convertFileSrc(path) : path;
}

function inputTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0";
  return (Math.round(seconds * 100) / 100).toString();
}

function preciseTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00.00";
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${(seconds % 60).toFixed(2).padStart(5, "0")}`;
}

interface WaveformTimelineProps {
  peaks: number[];
  loading: boolean;
  currentTime: number;
  duration: number;
  displayGain: WaveformGain;
  onSeek: (seconds: number) => void;
}

function WaveformTimeline({ peaks, loading, currentTime, duration, displayGain, onSeek }: WaveformTimelineProps) {
  const clipId = `played-${useId().replace(/:/g, "")}`;
  const displayPeaks = peaks.length > 0
    ? adjustWaveformPeaks(peaks, displayGain)
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
  exportingAudio: boolean;
  exportingVideo: boolean;
  disabled: boolean;
  displayGain: WaveformGain;
  presetSeconds: number;
  audioFormat: AudioExportFormat;
  silenceBefore: SilenceSeconds;
  silenceAfter: SilenceSeconds;
  fadeMilliseconds: FadeMilliseconds;
  exportedAudioPath: string | null;
  exportedVideoPath: string | null;
  onChange: (start: number, end: number) => void;
  onSeek: (seconds: number) => void;
  onPreview: () => void;
  onReset: () => void;
  onStartInput: (value: string) => void;
  onEndInput: (value: string) => void;
  onDisplayGainChange: (gain: WaveformGain) => void;
  onPresetSeconds: (seconds: number) => void;
  onAudioFormatChange: (format: AudioExportFormat) => void;
  onSilenceBeforeChange: (seconds: SilenceSeconds) => void;
  onSilenceAfterChange: (seconds: SilenceSeconds) => void;
  onFadeChange: (milliseconds: FadeMilliseconds) => void;
  onExportAudio: () => void;
  onExportVideo: () => void;
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
  exportingAudio,
  exportingVideo,
  disabled,
  displayGain,
  presetSeconds,
  audioFormat,
  silenceBefore,
  silenceAfter,
  fadeMilliseconds,
  exportedAudioPath,
  exportedVideoPath,
  onChange,
  onSeek,
  onPreview,
  onReset,
  onStartInput,
  onEndInput,
  onDisplayGainChange,
  onPresetSeconds,
  onAudioFormatChange,
  onSilenceBeforeChange,
  onSilenceAfterChange,
  onFadeChange,
  onExportAudio,
  onExportVideo,
  onReveal,
}: ClipRangeEditorProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ target: DragTarget; originTime: number; start: number; end: number } | null>(null);
  const [zoom, setZoom] = useState<TimelineZoom>(1);
  const selectedClipId = `selected-${useId().replace(/:/g, "")}`;
  const displayPeaks = peaks.length > 0
    ? adjustWaveformPeaks(peaks, displayGain)
    : Array.from({ length: 140 }, (_, index) => loading ? 0.14 + Math.abs(Math.sin(index * 0.39)) * 0.2 : 0.04);
  const barWidth = 100 / displayPeaks.length;
  const safeDuration = Math.max(duration, 0);
  const startPercent = safeDuration > 0 ? Math.min(100, Math.max(0, start / safeDuration * 100)) : 0;
  const endPercent = safeDuration > 0 ? Math.min(100, Math.max(startPercent, end / safeDuration * 100)) : 100;
  const playheadPercent = safeDuration > 0 ? Math.min(100, Math.max(0, currentTime / safeDuration * 100)) : 0;
  const selectionDuration = Math.max(0, end - start);
  const exportDuration = selectionDuration + silenceBefore + silenceAfter;

  useEffect(() => {
    const viewport = scrollRef.current;
    const timeline = timelineRef.current;
    if (!viewport || !timeline || safeDuration <= 0) return;
    const center = Math.min(1, Math.max(0, ((start + end) / 2) / safeDuration));
    viewport.scrollLeft = Math.max(0, timeline.scrollWidth * center - viewport.clientWidth / 2);
  }, [zoom, safeDuration]);

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
      onChange(Math.min(pointerTime, end - 0.01), end);
    } else if (drag.target === "end") {
      onChange(start, Math.max(pointerTime, start + 0.01));
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
    const amount = event.shiftKey ? 0.1 : 0.01;
    const direction = event.key === "ArrowRight" ? 1 : -1;
    if (target === "start") onChange(Math.min(end - 0.01, Math.max(0, start + amount * direction)), end);
    else onChange(start, Math.max(start + 0.01, Math.min(safeDuration, end + amount * direction)));
  }

  function seekFromTimeline(event: ReactPointerEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest("[data-trim-control]")) return;
    onSeek(timeAt(event.clientX));
  }

  return (
    <div className="clip-editor">
      <div className="clip-editor-head">
        <div className="export-label"><Scissors size={15} /><span><strong>Clip editor</strong><small>Drag either edge · drag the middle to move</small></span></div>
        <div className="timeline-zoom" aria-label="Timeline zoom controls">
          <span>ZOOM</span>
          <button aria-label="Zoom out" disabled={zoom === 1} onClick={() => setZoom((current) => Math.max(1, current / 2) as TimelineZoom)}><Minus size={11} /></button>
          <strong>{zoom === 1 ? "Fit" : `${zoom}×`}</strong>
          <button aria-label="Zoom in" disabled={zoom === 16} onClick={() => setZoom((current) => Math.min(16, current * 2) as TimelineZoom)}><Plus size={11} /></button>
          <button className="fit-zoom" disabled={zoom === 1} onClick={() => setZoom(1)}>Fit</button>
        </div>
        <label className="waveform-gain">
          <span>WAVE DISPLAY</span>
          <select
            aria-label="Waveform display gain"
            value={displayGain}
            onChange={(event) => onDisplayGainChange(event.target.value === "auto" ? "auto" : Number(event.target.value) as WaveformGain)}
          >
            <option value="auto">Auto</option>
            <option value="1">1×</option>
            <option value="2">2×</option>
            <option value="4">4×</option>
            <option value="8">8×</option>
          </select>
        </label>
        <div className="clip-summary"><span>{preciseTime(start)}</span><i>→</i><span>{preciseTime(end)}</span><strong>{selectionDuration.toFixed(2)} sec</strong></div>
        <button className="reset-clip" onClick={onReset}><RotateCcw size={12} /> Full track</button>
      </div>

      <div className="clip-range-scroll" ref={scrollRef} data-zoom={zoom}>
      <div className={`clip-range-timeline ${loading ? "loading" : ""}`} ref={timelineRef} onPointerDown={seekFromTimeline} style={{ width: `${zoom * 100}%` }}>
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
          aria-valuemax={Math.max(0, end - 0.01)}
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
          aria-valuemin={Math.min(safeDuration, start + 0.01)}
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
      </div>

      <div className="clip-preset-row">
        <span>CLIP LENGTH · 4–30 SEC</span>
        <input
          type="range"
          min="4"
          max="30"
          step="1"
          value={presetSeconds}
          onChange={(event) => onPresetSeconds(Number(event.target.value))}
          aria-label="Clip length preset in seconds"
        />
        <output>{presetSeconds} sec</output>
        <small>IN stays fixed; the range shifts left near the track end.</small>
      </div>

      <div className="clip-finishing-row">
        <span>EDGE FINISH</span>
        <label><span>BEFORE SILENCE</span><select aria-label="Silence before clip" value={silenceBefore} onChange={(event) => onSilenceBeforeChange(Number(event.target.value) as SilenceSeconds)}>
          <option value="0">0 sec</option><option value="0.1">0.1 sec</option><option value="0.25">0.25 sec</option><option value="0.5">0.5 sec</option><option value="1">1 sec</option><option value="2">2 sec</option>
        </select></label>
        <label><span>AFTER SILENCE</span><select aria-label="Silence after clip" value={silenceAfter} onChange={(event) => onSilenceAfterChange(Number(event.target.value) as SilenceSeconds)}>
          <option value="0">0 sec</option><option value="0.1">0.1 sec</option><option value="0.25">0.25 sec</option><option value="0.5">0.5 sec</option><option value="1">1 sec</option><option value="2">2 sec</option>
        </select></label>
        <label><span>EDGE FADE</span><select aria-label="Clip edge fade" value={fadeMilliseconds} onChange={(event) => onFadeChange(Number(event.target.value) as FadeMilliseconds)}>
          <option value="0">Off</option><option value="20">20 ms</option><option value="50">50 ms</option><option value="100">100 ms</option><option value="250">250 ms</option>
        </select></label>
        <output>{exportDuration.toFixed(2)} sec output</output>
      </div>

      <div className="clip-editor-controls">
        <label><span>START SEC</span><input aria-label="Clip start seconds" type="number" min="0" step="0.01" value={startValue} onChange={(event) => onStartInput(event.target.value)} /></label>
        <label><span>END SEC</span><input aria-label="Clip end seconds" type="number" min="0" step="0.01" value={endValue} onChange={(event) => onEndInput(event.target.value)} /></label>
        <button className={`preview-clip ${previewing ? "active" : ""}`} disabled={safeDuration <= 0} onClick={onPreview}>{previewing ? <Pause size={13} /> : <Play size={13} fill="currentColor" />}{previewing ? "Stop preview" : "Preview clip"}</button>
        <div className="audio-export-choice">
          <select aria-label="Audio export format" value={audioFormat} onChange={(event) => onAudioFormatChange(event.target.value as AudioExportFormat)}>
            <option value="wav">WAV</option>
            <option value="mp3">MP3</option>
          </select>
          <button className="export-button audio-export" disabled={disabled || exportingAudio || exportingVideo || safeDuration <= 0} onClick={onExportAudio}>
            {exportingAudio ? <LoaderCircle className="spin" size={14} /> : <FileAudio2 size={14} />}
            {exportingAudio ? "Exporting" : "Export audio"}
          </button>
          {exportedAudioPath && <button className="export-folder" aria-label="Show exported audio in folder" onClick={() => onReveal(exportedAudioPath)}><FolderOpen size={14} /></button>}
        </div>
        <button className="export-button video-export" disabled={disabled || exportingAudio || exportingVideo || safeDuration <= 0} onClick={onExportVideo}>
          {exportingVideo ? <LoaderCircle className="spin" size={14} /> : <Video size={14} />}
          {exportingVideo ? "Exporting" : "Black MP4"}
        </button>
        {exportedVideoPath && <button className="export-folder" aria-label="Show exported MP4 in folder" onClick={() => onReveal(exportedVideoPath)}><FolderOpen size={14} /></button>}
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
  const videoExportRequestRef = useRef("");
  const audioExportRequestRef = useRef("");
  const clipPreviewRangeRef = useRef<{ start: number; end: number } | null>(null);
  const clipInitializedRef = useRef(false);
  const previewTimerRef = useRef<number | null>(null);
  const [track, setTrack] = useState<PreviewTrack>("vocals");
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.85);
  const [audioError, setAudioError] = useState(false);
  const [waveform, setWaveform] = useState<number[]>([]);
  const [waveformLoading, setWaveformLoading] = useState(false);
  const [displayGain, setDisplayGain] = useState<WaveformGain>("auto");
  const [clipStart, setClipStart] = useState("0");
  const [clipEnd, setClipEnd] = useState("");
  const [clipEdited, setClipEdited] = useState(false);
  const [presetSeconds, setPresetSeconds] = useState(15);
  const [previewingClip, setPreviewingClip] = useState(false);
  const [silenceBefore, setSilenceBefore] = useState<SilenceSeconds>(0);
  const [silenceAfter, setSilenceAfter] = useState<SilenceSeconds>(0);
  const [fadeMilliseconds, setFadeMilliseconds] = useState<FadeMilliseconds>(50);
  const [audioFormat, setAudioFormat] = useState<AudioExportFormat>("wav");
  const [audioExportState, setAudioExportState] = useState<ExportState>("idle");
  const [videoExportState, setVideoExportState] = useState<ExportState>("idle");
  const [exportedAudioPath, setExportedAudioPath] = useState<string | null>(null);
  const [exportedVideoPath, setExportedVideoPath] = useState<string | null>(null);

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
    if (event.type === "export_video" && event.requestId === videoExportRequestRef.current) {
      if (event.state === "started") setVideoExportState("exporting");
      if (event.state === "completed" && event.path) {
        setVideoExportState("completed");
        setExportedVideoPath(event.path);
        onNotice("480p black-screen MP4 is ready.");
      }
      if (event.state === "failed") {
        setVideoExportState("idle");
        onNotice(event.message ?? "Could not export the MP4 file.");
      }
    }
    if (event.type === "export_audio" && event.requestId === audioExportRequestRef.current) {
      if (event.state === "started") setAudioExportState("exporting");
      if (event.state === "completed" && event.path) {
        setAudioExportState("completed");
        setExportedAudioPath(event.path);
        onNotice(`${(event.format ?? audioFormat).toUpperCase()} audio clip is ready.`);
      }
      if (event.state === "failed") {
        setAudioExportState("idle");
        onNotice(event.message ?? "Could not export the audio file.");
      }
    }
  }), [audioFormat, onNotice]);

  useEffect(() => {
    if (previewTimerRef.current !== null) window.clearTimeout(previewTimerRef.current);
    previewTimerRef.current = null;
    resumeTimeRef.current = 0;
    resumePlaybackRef.current = false;
    setTrack("vocals");
    setPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setAudioError(false);
    setDisplayGain("auto");
    setClipStart("0");
    setClipEnd("");
    setClipEdited(false);
    clipInitializedRef.current = false;
    setPresetSeconds(15);
    clipPreviewRangeRef.current = null;
    setPreviewingClip(false);
    setAudioExportState("idle");
    setVideoExportState("idle");
    setExportedAudioPath(null);
    setExportedVideoPath(null);
  }, [item?.id]);

  useEffect(() => () => {
    if (previewTimerRef.current !== null) window.clearTimeout(previewTimerRef.current);
  }, []);

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
    cancelClipPreview(false);
    resumeTimeRef.current = audio?.currentTime ?? currentTime;
    resumePlaybackRef.current = Boolean(audio && !audio.paused);
    setExportedAudioPath(null);
    setExportedVideoPath(null);
    setTrack(nextTrack);
  }

  async function handleMetadata(audio: HTMLAudioElement) {
    const nextDuration = audio.duration;
    const resumeAt = Math.min(resumeTimeRef.current, Number.isFinite(nextDuration) ? nextDuration : 0);
    audio.currentTime = resumeAt;
    setDuration(nextDuration);
    setCurrentTime(resumeAt);
    initializeClip(nextDuration);
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
      cancelClipPreview(false);
      try {
        await audio.play();
      } catch {
        setAudioError(true);
      }
    } else {
      audio.pause();
      cancelClipPreview(false);
    }
  }

  function handleTimeUpdate(audio: HTMLAudioElement) {
    const nextTime = audio.currentTime;
    const previewRange = clipPreviewRangeRef.current;
    if (previewRange) {
      const fadeSeconds = fadeMilliseconds / 1000;
      if (fadeSeconds > 0) {
        const fadeInGain = Math.min(1, Math.max(0, (nextTime - previewRange.start) / fadeSeconds));
        const fadeOutGain = Math.min(1, Math.max(0, (previewRange.end - nextTime) / fadeSeconds));
        audio.volume = volume * Math.min(fadeInGain, fadeOutGain);
      }
      if (nextTime >= previewRange.end) {
        audio.pause();
        audio.volume = volume;
        audio.currentTime = previewRange.start;
        setCurrentTime(previewRange.start);
        clipPreviewRangeRef.current = null;
        if (silenceAfter > 0) {
          previewTimerRef.current = window.setTimeout(() => finishClipPreview(), silenceAfter * 1000);
        } else finishClipPreview();
        return;
      }
    }
    setCurrentTime(nextTime);
  }

  function seek(value: number) {
    const audio = audioRef.current;
    if (!audio) return;
    if (previewingClip) cancelClipPreview();
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
    if (previewingClip) cancelClipPreview();
    setClipEdited(true);
    setClipStart(inputTime(start));
    setClipEnd(inputTime(end));
  }

  function initializeClip(nextDuration: number) {
    if (clipInitializedRef.current || !Number.isFinite(nextDuration) || nextDuration <= 0) return;
    clipInitializedRef.current = true;
    const range = clipRangeForPreset(0, presetSeconds, nextDuration);
    setClipStart(inputTime(range.start));
    setClipEnd(inputTime(range.end));
    setClipEdited(range.end < nextDuration);
  }

  function resetClip() {
    if (previewingClip) cancelClipPreview();
    setClipStart("0");
    setClipEnd(inputTime(duration));
    setClipEdited(false);
  }

  function applyPresetSeconds(seconds: number) {
    setPresetSeconds(seconds);
    const range = clipRangeForPreset(clipRange.start, seconds, duration);
    setClipRange(range.start, range.end);
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
      cancelClipPreview();
      return;
    }
    resumeTimeRef.current = range.start;
    setPreviewingClip(true);
    audio.pause();
    audio.currentTime = range.start;
    setCurrentTime(range.start);
    if (silenceBefore > 0) {
      previewTimerRef.current = window.setTimeout(() => void startClipAudio(audio, range), silenceBefore * 1000);
      return;
    }
    await startClipAudio(audio, range);
  }

  async function startClipAudio(audio: HTMLAudioElement, range: { start: number; end: number }) {
    previewTimerRef.current = null;
    clipPreviewRangeRef.current = range;
    audio.volume = fadeMilliseconds > 0 ? 0 : volume;
    try {
      await audio.play();
    } catch {
      cancelClipPreview(false);
      setAudioError(true);
    }
  }

  function finishClipPreview() {
    previewTimerRef.current = null;
    clipPreviewRangeRef.current = null;
    setPreviewingClip(false);
  }

  function cancelClipPreview(pauseAudio = true) {
    if (previewTimerRef.current !== null) window.clearTimeout(previewTimerRef.current);
    previewTimerRef.current = null;
    clipPreviewRangeRef.current = null;
    const audio = audioRef.current;
    if (audio) {
      if (pauseAudio) audio.pause();
      audio.volume = volume;
    }
    setPreviewingClip(false);
  }

  function handleEnded(audio: HTMLAudioElement) {
    setPlaying(false);
    const range = clipPreviewRangeRef.current;
    audio.volume = volume;
    if (!range) return;
    audio.currentTime = range.start;
    setCurrentTime(range.start);
    clipPreviewRangeRef.current = null;
    if (silenceAfter > 0) {
      previewTimerRef.current = window.setTimeout(() => finishClipPreview(), silenceAfter * 1000);
    } else finishClipPreview();
  }

  function exportVideo() {
    if (!activePath) return;
    const range = parseClipRange(clipStart, clipEnd, duration);
    if (!range) {
      onNotice("Enter a valid start and end time within the track.");
      return;
    }
    const requestId = newId();
    videoExportRequestRef.current = requestId;
    setVideoExportState("exporting");
    setExportedVideoPath(null);
    void backend.send({
      type: "export_video",
      requestId,
      path: activePath,
      startSeconds: clipEdited ? range.start : 0,
      endSeconds: clipEdited ? range.end : null,
      contentDurationSeconds: range.end - range.start,
      silenceBeforeSeconds: silenceBefore,
      silenceAfterSeconds: silenceAfter,
      fadeSeconds: fadeMilliseconds / 1000,
    }).catch(() => {
      setVideoExportState("idle");
      onNotice("Could not start the MP4 export.");
    });
  }

  function exportAudio() {
    if (!activePath) return;
    const range = parseClipRange(clipStart, clipEnd, duration);
    if (!range) {
      onNotice("Enter a valid start and end time within the track.");
      return;
    }
    const requestId = newId();
    audioExportRequestRef.current = requestId;
    setAudioExportState("exporting");
    setExportedAudioPath(null);
    void backend.send({
      type: "export_audio",
      requestId,
      path: activePath,
      format: audioFormat,
      startSeconds: clipEdited ? range.start : 0,
      endSeconds: clipEdited ? range.end : null,
      contentDurationSeconds: range.end - range.start,
      silenceBeforeSeconds: silenceBefore,
      silenceAfterSeconds: silenceAfter,
      fadeSeconds: fadeMilliseconds / 1000,
    }).catch(() => {
      setAudioExportState("idle");
      onNotice("Could not start the audio export.");
    });
  }

  if (!item || !item.outputs?.length) {
    return (
      <section className="result-player result-player-empty" aria-label="Result preview">
        <div className="result-empty-icon"><AudioWaveform size={22} /></div>
        <div>
          <span className="eyebrow">RESULT MONITOR</span>
          <strong>Preview appears when a track is complete</strong>
          <small>Compare stems, trim by time, and export audio or a 480p black-screen video.</small>
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
          initializeClip(nextDuration);
        }}
        onTimeUpdate={(event) => handleTimeUpdate(event.currentTarget)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={(event) => handleEnded(event.currentTarget)}
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
        <WaveformTimeline peaks={waveform} loading={waveformLoading} currentTime={currentTime} duration={duration} displayGain={displayGain} onSeek={seek} />
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
        exportingAudio={audioExportState === "exporting"}
        exportingVideo={videoExportState === "exporting"}
        disabled={disabled}
        displayGain={displayGain}
        presetSeconds={presetSeconds}
        audioFormat={audioFormat}
        silenceBefore={silenceBefore}
        silenceAfter={silenceAfter}
        fadeMilliseconds={fadeMilliseconds}
        exportedAudioPath={exportedAudioPath}
        exportedVideoPath={exportedVideoPath}
        onChange={setClipRange}
        onSeek={seek}
        onPreview={() => void previewClip()}
        onReset={resetClip}
        onStartInput={(value) => { if (previewingClip) cancelClipPreview(); setClipEdited(true); setClipStart(value); }}
        onEndInput={(value) => { if (previewingClip) cancelClipPreview(); setClipEdited(true); setClipEnd(value); }}
        onDisplayGainChange={setDisplayGain}
        onPresetSeconds={applyPresetSeconds}
        onAudioFormatChange={setAudioFormat}
        onSilenceBeforeChange={setSilenceBefore}
        onSilenceAfterChange={setSilenceAfter}
        onFadeChange={setFadeMilliseconds}
        onExportAudio={exportAudio}
        onExportVideo={exportVideo}
        onReveal={onReveal}
      />
    </section>
  );
}
