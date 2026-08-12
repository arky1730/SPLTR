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

export interface FixedClipLayout {
  sourceStart: number;
  sourceEnd: number;
  silenceBefore: number;
  silenceAfter: number;
}

const MIN_AUDIO_SECONDS = 0.05;

export function fixedOutputDuration(layout: FixedClipLayout): number {
  return layout.silenceBefore + Math.max(0, layout.sourceEnd - layout.sourceStart) + layout.silenceAfter;
}

export function sourceTimeForClipPosition(position: number, layout: FixedClipLayout): number | null {
  const audioDuration = Math.max(0, layout.sourceEnd - layout.sourceStart);
  const audioPosition = position - layout.silenceBefore;
  if (audioPosition < 0 || audioPosition > audioDuration) return null;
  return layout.sourceStart + audioPosition;
}

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
  return roundTime(seconds).toString();
}

function roundTime(seconds: number): number {
  return Math.round(seconds * 100) / 100;
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
  clipPosition: number;
  duration: number;
  layout: FixedClipLayout;
  outputDuration: number;
  startValue: string;
  endValue: string;
  previewing: boolean;
  exportingAudio: boolean;
  exportingVideo: boolean;
  disabled: boolean;
  displayGain: WaveformGain;
  presetSeconds: number;
  audioFormat: AudioExportFormat;
  fadeInSeconds: number;
  fadeOutSeconds: number;
  exportedAudioPath: string | null;
  exportedVideoPath: string | null;
  onLayoutChange: (layout: FixedClipLayout) => void;
  onSeek: (seconds: number) => void;
  onClipSeek: (seconds: number) => void;
  onPreview: () => void;
  onReset: () => void;
  onStartInput: (value: string) => void;
  onEndInput: (value: string) => void;
  onDisplayGainChange: (gain: WaveformGain) => void;
  onPresetSeconds: (seconds: number) => void;
  onAudioFormatChange: (format: AudioExportFormat) => void;
  onFadeInChange: (seconds: number) => void;
  onFadeOutChange: (seconds: number) => void;
  onExportAudio: () => void;
  onExportVideo: () => void;
  onReveal: (path: string) => void;
}

type DragTarget = "audio-start" | "audio-end" | "audio-block" | "source-block" | "fade-in" | "fade-out";

function ClipRangeEditor({
  peaks,
  loading,
  clipPosition,
  duration,
  layout,
  outputDuration,
  startValue,
  endValue,
  previewing,
  exportingAudio,
  exportingVideo,
  disabled,
  displayGain,
  presetSeconds,
  audioFormat,
  fadeInSeconds,
  fadeOutSeconds,
  exportedAudioPath,
  exportedVideoPath,
  onLayoutChange,
  onSeek,
  onClipSeek,
  onPreview,
  onReset,
  onStartInput,
  onEndInput,
  onDisplayGainChange,
  onPresetSeconds,
  onAudioFormatChange,
  onFadeInChange,
  onFadeOutChange,
  onExportAudio,
  onExportVideo,
  onReveal,
}: ClipRangeEditorProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const outputTimelineRef = useRef<HTMLDivElement>(null);
  const sourceTimelineRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ target: DragTarget; originTime: number; layout: FixedClipLayout; fadeIn: number; fadeOut: number; pointerStartX: number; moved: boolean } | null>(null);
  const scrubRef = useRef(false);
  const [zoom, setZoom] = useState<TimelineZoom>(1);
  const displayPeaks = peaks.length > 0
    ? adjustWaveformPeaks(peaks, displayGain)
    : Array.from({ length: 140 }, (_, index) => loading ? 0.14 + Math.abs(Math.sin(index * 0.39)) * 0.2 : 0.04);
  const safeDuration = Math.max(duration, 0);
  const safeOutputDuration = Math.max(MIN_AUDIO_SECONDS, outputDuration);
  const contentDuration = Math.max(MIN_AUDIO_SECONDS, layout.sourceEnd - layout.sourceStart);
  const audioStart = layout.silenceBefore;
  const audioEnd = safeOutputDuration - layout.silenceAfter;
  const audioStartPercent = audioStart / safeOutputDuration * 100;
  const audioEndPercent = audioEnd / safeOutputDuration * 100;
  const contentPercent = contentDuration / safeOutputDuration * 100;
  const sourceStartPercent = safeDuration > 0 ? layout.sourceStart / safeDuration * 100 : 0;
  const sourceEndPercent = safeDuration > 0 ? layout.sourceEnd / safeDuration * 100 : 0;
  const safeClipPosition = Math.min(safeOutputDuration, Math.max(0, clipPosition));
  const playheadPercent = safeClipPosition / safeOutputDuration * 100;

  useEffect(() => {
    const viewport = scrollRef.current;
    const timeline = outputTimelineRef.current;
    if (!viewport || !timeline || safeDuration <= 0) return;
    const center = (audioStart + audioEnd) / 2 / safeOutputDuration;
    viewport.scrollLeft = Math.max(0, timeline.scrollWidth * center - viewport.clientWidth / 2);
  }, [zoom, safeDuration, safeOutputDuration]);

  const outputBars = displayPeaks.flatMap((peak, index) => {
    if (safeDuration <= 0) return [];
    const sourceTime = (index + 0.5) / displayPeaks.length * safeDuration;
    if (sourceTime < layout.sourceStart || sourceTime > layout.sourceEnd) return [];
    const x = (audioStart + sourceTime - layout.sourceStart) / safeOutputDuration * 100;
    const width = Math.max(0.08, safeDuration / displayPeaks.length / safeOutputDuration * 72);
    const height = Math.max(3, Math.min(48, peak * 48));
    return [<rect key={index} x={x} y={(52 - height) / 2} width={width} height={height} rx={0.18} />];
  });

  const sourceBars = displayPeaks.map((peak, index) => {
    const width = 100 / displayPeaks.length;
    const height = Math.max(2, Math.min(24, peak * 24));
    return <rect key={index} x={index * width} y={(26 - height) / 2} width={Math.max(0.08, width * 0.62)} height={height} rx={0.12} />;
  });

  function outputTimeAt(clientX: number): number {
    const rect = outputTimelineRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    return Math.min(safeOutputDuration, Math.max(0, (clientX - rect.left) / rect.width * safeOutputDuration));
  }

  function sourceTimeAt(clientX: number): number {
    const rect = sourceTimelineRef.current?.getBoundingClientRect();
    if (!rect || safeDuration <= 0) return 0;
    return Math.min(safeDuration, Math.max(0, (clientX - rect.left) / rect.width * safeDuration));
  }

  function beginDrag(target: DragTarget, event: ReactPointerEvent<HTMLButtonElement>) {
    if (safeDuration <= 0 || safeOutputDuration <= 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      target,
      originTime: target === "source-block" ? sourceTimeAt(event.clientX) : outputTimeAt(event.clientX),
      layout: { ...layout },
      fadeIn: fadeInSeconds,
      fadeOut: fadeOutSeconds,
      pointerStartX: event.clientX,
      moved: false,
    };
  }

  function continueDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    if (!drag || safeDuration <= 0) return;
    const originalContent = drag.layout.sourceEnd - drag.layout.sourceStart;
    const originalAudioStart = drag.layout.silenceBefore;
    const originalAudioEnd = safeOutputDuration - drag.layout.silenceAfter;
    if (drag.target === "audio-block" && !drag.moved) {
      if (Math.abs(event.clientX - drag.pointerStartX) < 4) return;
      drag.moved = true;
    }

    if (drag.target === "source-block") {
      const delta = sourceTimeAt(event.clientX) - drag.originTime;
      const nextStart = Math.min(safeDuration - originalContent, Math.max(0, drag.layout.sourceStart + delta));
      onLayoutChange({ ...drag.layout, sourceStart: nextStart, sourceEnd: nextStart + originalContent });
      return;
    }

    const pointerTime = outputTimeAt(event.clientX);
    if (drag.target === "audio-start") {
      const minimum = Math.max(0, originalAudioStart - drag.layout.sourceStart);
      const nextAudioStart = Math.min(originalAudioEnd - MIN_AUDIO_SECONDS, Math.max(minimum, pointerTime));
      const delta = nextAudioStart - originalAudioStart;
      onLayoutChange({ ...drag.layout, sourceStart: drag.layout.sourceStart + delta, silenceBefore: nextAudioStart });
    } else if (drag.target === "audio-end") {
      const maximum = Math.min(safeOutputDuration, originalAudioEnd + safeDuration - drag.layout.sourceEnd);
      const nextAudioEnd = Math.max(originalAudioStart + MIN_AUDIO_SECONDS, Math.min(maximum, pointerTime));
      const delta = nextAudioEnd - originalAudioEnd;
      onLayoutChange({ ...drag.layout, sourceEnd: drag.layout.sourceEnd + delta, silenceAfter: safeOutputDuration - nextAudioEnd });
    } else if (drag.target === "audio-block") {
      const delta = pointerTime - drag.originTime;
      const nextBefore = Math.min(safeOutputDuration - originalContent, Math.max(0, originalAudioStart + delta));
      onLayoutChange({ ...drag.layout, silenceBefore: nextBefore, silenceAfter: safeOutputDuration - originalContent - nextBefore });
    } else if (drag.target === "fade-in") {
      onFadeInChange(Math.min(contentDuration / 2, Math.max(0, pointerTime - originalAudioStart)));
    } else if (drag.target === "fade-out") {
      onFadeOutChange(Math.min(contentDuration / 2, Math.max(0, originalAudioEnd - pointerTime)));
    }
  }

  function endDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    dragRef.current = null;
    if (drag?.target === "audio-block" && !drag.moved) onClipSeek(outputTimeAt(event.clientX));
  }

  function adjustHandle(target: "start" | "end", event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (safeDuration <= 0) return;
    if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
    event.preventDefault();
    const amount = event.shiftKey ? 0.1 : 0.01;
    const direction = event.key === "ArrowRight" ? 1 : -1;
    const pointer = (target === "start" ? audioStart : audioEnd) + amount * direction;
    const fakeDrag = {
      target: target === "start" ? "audio-start" as const : "audio-end" as const,
      originTime: target === "start" ? audioStart : audioEnd,
      layout: { ...layout }, fadeIn: fadeInSeconds, fadeOut: fadeOutSeconds, pointerStartX: 0, moved: true,
    };
    dragRef.current = fakeDrag;
    const originalRect = outputTimelineRef.current?.getBoundingClientRect();
    if (originalRect) {
      const clientX = originalRect.left + pointer / safeOutputDuration * originalRect.width;
      continueDrag({ clientX } as ReactPointerEvent<HTMLButtonElement>);
    }
    dragRef.current = null;
  }

  function beginOutputScrub(event: ReactPointerEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest("[data-trim-control]")) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    scrubRef.current = true;
    onClipSeek(outputTimeAt(event.clientX));
  }

  function continueOutputScrub(event: ReactPointerEvent<HTMLDivElement>) {
    if (!scrubRef.current) return;
    onClipSeek(outputTimeAt(event.clientX));
  }

  function endOutputScrub(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    scrubRef.current = false;
  }

  function beginPlayheadScrub(event: ReactPointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    scrubRef.current = true;
    onClipSeek(outputTimeAt(event.clientX));
  }

  function continuePlayheadScrub(event: ReactPointerEvent<HTMLButtonElement>) {
    if (!scrubRef.current) return;
    onClipSeek(outputTimeAt(event.clientX));
  }

  function endPlayheadScrub(event: ReactPointerEvent<HTMLButtonElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    scrubRef.current = false;
  }

  function setSilenceBefore(value: number) {
    const next = Math.min(audioEnd - MIN_AUDIO_SECONDS, Math.max(Math.max(0, audioStart - layout.sourceStart), value));
    const delta = next - audioStart;
    onLayoutChange({ ...layout, sourceStart: layout.sourceStart + delta, silenceBefore: next });
  }

  function setSilenceAfter(value: number) {
    const next = Math.min(safeOutputDuration - audioStart - MIN_AUDIO_SECONDS, Math.max(Math.max(0, layout.sourceEnd - safeDuration + layout.silenceAfter), value));
    const delta = next - layout.silenceAfter;
    onLayoutChange({ ...layout, sourceEnd: layout.sourceEnd - delta, silenceAfter: next });
  }

  function addLeadingSilence() {
    setSilenceBefore(layout.silenceBefore + 0.1);
  }

  function addTrailingSilence() {
    setSilenceAfter(layout.silenceAfter + 0.1);
  }

  return (
    <div className="clip-editor">
      <div className="clip-editor-head">
        <div className="export-label"><Scissors size={15} /><span><strong>Fixed-length clip</strong><small>Trim the audio block; the empty area becomes silence</small></span></div>
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
        <div className="clip-summary"><span>OUTPUT</span><strong>{safeOutputDuration.toFixed(2)} sec</strong><i>•</i><span>AUDIO</span><strong>{contentDuration.toFixed(2)} sec</strong></div>
        <button className="reset-clip" onClick={onReset}><RotateCcw size={12} /> Reset clip</button>
      </div>

      <div className="clip-track-transport">
        <div className="clip-track-controls">
          <button className={`clip-track-play ${previewing ? "active" : ""}`} disabled={safeDuration <= 0} onClick={onPreview} aria-label={previewing ? "Stop clip preview" : "Play clip preview"}>
            {previewing ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" />}
          </button>
          <span>{preciseTime(safeClipPosition)}</span>
          <small>/ {preciseTime(safeOutputDuration)}</small>
        </div>
        <div className="clip-range-scroll" ref={scrollRef} data-zoom={zoom}>
      <div
        className={`clip-range-timeline fixed-output-timeline ${loading ? "loading" : ""}`}
        ref={outputTimelineRef}
        onPointerDown={beginOutputScrub}
        onPointerMove={continueOutputScrub}
        onPointerUp={endOutputScrub}
        onPointerCancel={endOutputScrub}
        style={{ width: `${zoom * 100}%` }}
      >
        <div className="output-ruler"><span>0.00</span><strong>OUTPUT CLIP · {safeOutputDuration.toFixed(2)} SEC</strong><span>{safeOutputDuration.toFixed(2)}</span></div>
        <div className="silence-region silence-before" style={{ width: `${audioStartPercent}%` }}><span>{layout.silenceBefore >= .01 ? `${layout.silenceBefore.toFixed(2)}s` : ""}</span></div>
        <div className="silence-region silence-after" style={{ left: `${audioEndPercent}%` }}><span>{layout.silenceAfter >= .01 ? `${layout.silenceAfter.toFixed(2)}s` : ""}</span></div>
        <svg viewBox="0 0 100 52" preserveAspectRatio="none" aria-hidden="true">
          <g className="clip-wave-selected">{outputBars}</g>
        </svg>
        <button
          type="button"
          className="clip-selection-drag audio-clip-block"
          data-trim-control
          aria-label="Move audio block inside output clip"
          style={{ left: `${audioStartPercent}%`, width: `${contentPercent}%` }}
          onPointerDown={(event) => beginDrag("audio-block", event)}
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
          aria-valuemax={Math.max(0, audioEnd - MIN_AUDIO_SECONDS)}
          aria-valuenow={audioStart}
          aria-valuetext={`${layout.silenceBefore.toFixed(2)} seconds leading silence`}
          style={{ left: `${audioStartPercent}%` }}
          onKeyDown={(event) => adjustHandle("start", event)}
          onPointerDown={(event) => beginDrag("audio-start", event)}
          onPointerMove={continueDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        ><i /><span>TRIM IN</span></button>
        <button
          type="button"
          className="clip-handle clip-handle-end"
          data-trim-control
          role="slider"
          aria-label="Trim end"
          aria-valuemin={Math.min(safeOutputDuration, audioStart + MIN_AUDIO_SECONDS)}
          aria-valuemax={safeOutputDuration}
          aria-valuenow={audioEnd}
          aria-valuetext={`${layout.silenceAfter.toFixed(2)} seconds trailing silence`}
          style={{ left: `${audioEndPercent}%` }}
          onKeyDown={(event) => adjustHandle("end", event)}
          onPointerDown={(event) => beginDrag("audio-end", event)}
          onPointerMove={continueDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        ><i /><span>TRIM OUT</span></button>
        {fadeInSeconds > 0 && <div className="fade-shade fade-shade-in" style={{ left: `${audioStartPercent}%`, width: `${fadeInSeconds / safeOutputDuration * 100}%` }} />}
        {fadeOutSeconds > 0 && <div className="fade-shade fade-shade-out" style={{ left: `${(audioEnd - fadeOutSeconds) / safeOutputDuration * 100}%`, width: `${fadeOutSeconds / safeOutputDuration * 100}%` }} />}
        <button className="fade-handle fade-in-handle" data-trim-control aria-label="Drag fade in" style={{ left: `${(audioStart + fadeInSeconds) / safeOutputDuration * 100}%` }} onPointerDown={(event) => beginDrag("fade-in", event)} onPointerMove={continueDrag} onPointerUp={endDrag} onPointerCancel={endDrag}><span>FADE IN</span></button>
        <button className="fade-handle fade-out-handle" data-trim-control aria-label="Drag fade out" style={{ left: `${(audioEnd - fadeOutSeconds) / safeOutputDuration * 100}%` }} onPointerDown={(event) => beginDrag("fade-out", event)} onPointerMove={continueDrag} onPointerUp={endDrag} onPointerCancel={endDrag}><span>FADE OUT</span></button>
        <button
          type="button"
          className="clip-playhead"
          data-trim-control
          aria-label="Clip playhead"
          style={{ left: `${playheadPercent}%` }}
          onPointerDown={beginPlayheadScrub}
          onPointerMove={continuePlayheadScrub}
          onPointerUp={endPlayheadScrub}
          onPointerCancel={endPlayheadScrub}
        ><i /></button>
      </div>
      </div>
      </div>

      <div className="clip-silence-actions">
        <button type="button" className="silence-add" disabled={contentDuration <= MIN_AUDIO_SECONDS} onClick={addLeadingSilence}>+ Lead silence</button>
        <span>Click or drag directly on the waveform to seek</span>
        <button type="button" className="silence-add" disabled={contentDuration <= MIN_AUDIO_SECONDS} onClick={addTrailingSilence}>+ End silence</button>
      </div>

      <div className="source-strip-wrap">
        <div className="source-strip-label"><span>SOURCE POSITION</span><small>Drag the purple block to choose another part of the song</small></div>
        <div className="source-strip" ref={sourceTimelineRef} onPointerDown={(event) => { if (!(event.target as HTMLElement).closest("[data-trim-control]")) onSeek(sourceTimeAt(event.clientX)); }}>
          <svg viewBox="0 0 100 26" preserveAspectRatio="none" aria-hidden="true"><g>{sourceBars}</g></svg>
          <div className="source-strip-outside source-strip-before" style={{ width: `${sourceStartPercent}%` }} />
          <div className="source-strip-outside source-strip-after" style={{ left: `${sourceEndPercent}%` }} />
          <button className="source-selection" data-trim-control aria-label="Move source selection" style={{ left: `${sourceStartPercent}%`, width: `${sourceEndPercent - sourceStartPercent}%` }} onPointerDown={(event) => beginDrag("source-block", event)} onPointerMove={continueDrag} onPointerUp={endDrag} onPointerCancel={endDrag}><span>{preciseTime(layout.sourceStart)} → {preciseTime(layout.sourceEnd)}</span></button>
        </div>
      </div>

      <div className="clip-preset-row">
        <span>FIXED OUTPUT LENGTH · 4–30 SEC</span>
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
        <small>Changing this resets the frame; trimming never changes this total.</small>
      </div>

      <div className="clip-finishing-row">
        <span>PRECISE VALUES</span>
        <label><span>LEAD SILENCE</span><input aria-label="Leading silence seconds" type="number" min="0" max={safeOutputDuration} step="0.01" value={inputTime(layout.silenceBefore)} onChange={(event) => setSilenceBefore(Number(event.target.value))} /></label>
        <label><span>END SILENCE</span><input aria-label="Trailing silence seconds" type="number" min="0" max={safeOutputDuration} step="0.01" value={inputTime(layout.silenceAfter)} onChange={(event) => setSilenceAfter(Number(event.target.value))} /></label>
        <label><span>FADE IN</span><input aria-label="Fade in seconds" type="number" min="0" max={contentDuration / 2} step="0.01" value={inputTime(fadeInSeconds)} onChange={(event) => onFadeInChange(Math.min(contentDuration / 2, Math.max(0, Number(event.target.value))))} /></label>
        <label><span>FADE OUT</span><input aria-label="Fade out seconds" type="number" min="0" max={contentDuration / 2} step="0.01" value={inputTime(fadeOutSeconds)} onChange={(event) => onFadeOutChange(Math.min(contentDuration / 2, Math.max(0, Number(event.target.value))))} /></label>
        <output>{fixedOutputDuration(layout).toFixed(2)} / {safeOutputDuration.toFixed(2)} sec</output>
      </div>

      <div className="clip-editor-controls">
        <label><span>SOURCE IN</span><input aria-label="Clip start seconds" type="number" min="0" step="0.01" value={startValue} onChange={(event) => onStartInput(event.target.value)} /></label>
        <label><span>SOURCE OUT</span><input aria-label="Clip end seconds" type="number" min="0" step="0.01" value={endValue} onChange={(event) => onEndInput(event.target.value)} /></label>
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
  const [presetSeconds, setPresetSeconds] = useState(15);
  const [previewingClip, setPreviewingClip] = useState(false);
  const [clipPosition, setClipPosition] = useState(0);
  const [silenceBefore, setSilenceBefore] = useState(0);
  const [silenceAfter, setSilenceAfter] = useState(0);
  const [fadeInSeconds, setFadeInSeconds] = useState(0.05);
  const [fadeOutSeconds, setFadeOutSeconds] = useState(0.05);
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
  const clipRange = parseClipRange(clipStart, clipEnd, duration) ?? { start: 0, end: Math.max(0, Math.min(duration, presetSeconds)) };
  const clipLayout: FixedClipLayout = {
    sourceStart: clipRange.start,
    sourceEnd: clipRange.end,
    silenceBefore,
    silenceAfter,
  };

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
    if (previewTimerRef.current !== null) window.clearInterval(previewTimerRef.current);
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
    clipInitializedRef.current = false;
    setPresetSeconds(15);
    setClipPosition(0);
    setSilenceBefore(0);
    setSilenceAfter(0);
    setFadeInSeconds(0.05);
    setFadeOutSeconds(0.05);
    clipPreviewRangeRef.current = null;
    setPreviewingClip(false);
    setAudioExportState("idle");
    setVideoExportState("idle");
    setExportedAudioPath(null);
    setExportedVideoPath(null);
  }, [item?.id]);

  useEffect(() => () => {
    if (previewTimerRef.current !== null) window.clearInterval(previewTimerRef.current);
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
      const fadeInGain = fadeInSeconds > 0
        ? Math.min(1, Math.max(0, (nextTime - previewRange.start) / fadeInSeconds)) : 1;
      const fadeOutGain = fadeOutSeconds > 0
        ? Math.min(1, Math.max(0, (previewRange.end - nextTime) / fadeOutSeconds)) : 1;
      audio.volume = volume * Math.min(fadeInGain, fadeOutGain);
      setClipPosition(Math.min(presetSeconds - silenceAfter, silenceBefore + nextTime - previewRange.start));
      if (nextTime >= previewRange.end) {
        audio.pause();
        audio.volume = volume;
        audio.currentTime = previewRange.end;
        setCurrentTime(previewRange.end);
        clipPreviewRangeRef.current = null;
        if (silenceAfter > 0) {
          playSilence(presetSeconds - silenceAfter, presetSeconds, finishClipPreview);
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

  function seekClip(value: number) {
    const audio = audioRef.current;
    if (!audio) return;
    if (previewingClip) cancelClipPreview();
    const nextPosition = Math.min(presetSeconds, Math.max(0, value));
    setClipPosition(nextPosition);
    audio.pause();
    const sourceTime = sourceTimeForClipPosition(nextPosition, clipLayout);
    if (sourceTime === null) {
      const boundary = nextPosition < silenceBefore ? clipRange.start : clipRange.end;
      audio.currentTime = boundary;
      setCurrentTime(boundary);
      return;
    }
    audio.currentTime = sourceTime;
    setCurrentTime(sourceTime);
  }

  function changeVolume(value: number) {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = value;
    setVolume(value);
  }

  function setClipLayout(next: FixedClipLayout) {
    if (previewingClip) cancelClipPreview();
    const sourceStart = roundTime(Math.max(0, Math.min(Math.max(0, duration - MIN_AUDIO_SECONDS), next.sourceStart)));
    const sourceEnd = roundTime(Math.max(sourceStart + MIN_AUDIO_SECONDS, Math.min(duration, next.sourceEnd)));
    const content = sourceEnd - sourceStart;
    const before = roundTime(Math.max(0, Math.min(Math.max(0, presetSeconds - content), next.silenceBefore)));
    const after = roundTime(Math.max(0, presetSeconds - content - before));
    setClipStart(inputTime(sourceStart));
    setClipEnd(inputTime(sourceEnd));
    setSilenceBefore(before);
    setSilenceAfter(after);
    setFadeInSeconds((value) => Math.min(value, content / 2));
    setFadeOutSeconds((value) => Math.min(value, content / 2));
  }

  function changeFadeIn(seconds: number) {
    setFadeInSeconds(roundTime(Math.max(0, Math.min((clipRange.end - clipRange.start) / 2, seconds))));
  }

  function changeFadeOut(seconds: number) {
    setFadeOutSeconds(roundTime(Math.max(0, Math.min((clipRange.end - clipRange.start) / 2, seconds))));
  }

  function initializeClip(nextDuration: number) {
    if (clipInitializedRef.current || !Number.isFinite(nextDuration) || nextDuration <= 0) return;
    clipInitializedRef.current = true;
    const range = clipRangeForPreset(0, presetSeconds, nextDuration);
    setClipStart(inputTime(range.start));
    setClipEnd(inputTime(range.end));
    setSilenceBefore(0);
    setSilenceAfter(Math.max(0, presetSeconds - (range.end - range.start)));
  }

  function resetClip() {
    if (previewingClip) cancelClipPreview();
    const range = clipRangeForPreset(clipRange.start, presetSeconds, duration);
    setClipStart(inputTime(range.start));
    setClipEnd(inputTime(range.end));
    setSilenceBefore(0);
    setSilenceAfter(Math.max(0, presetSeconds - (range.end - range.start)));
    setFadeInSeconds(0.05);
    setFadeOutSeconds(0.05);
    setClipPosition(0);
  }

  function applyPresetSeconds(seconds: number) {
    if (previewingClip) cancelClipPreview();
    setPresetSeconds(seconds);
    const range = clipRangeForPreset(clipRange.start, seconds, duration);
    setClipStart(inputTime(range.start));
    setClipEnd(inputTime(range.end));
    setSilenceBefore(0);
    setSilenceAfter(Math.max(0, seconds - (range.end - range.start)));
    setFadeInSeconds((value) => Math.min(value, (range.end - range.start) / 2));
    setFadeOutSeconds((value) => Math.min(value, (range.end - range.start) / 2));
    setClipPosition(0);
  }

  function changeSourceStart(value: string) {
    if (previewingClip) cancelClipPreview();
    if (value === "") {
      setClipStart(value);
      return;
    }
    const requested = Number(value);
    if (!Number.isFinite(requested)) return;
    const nextStart = Math.max(0, Math.min(clipRange.end - MIN_AUDIO_SECONDS, requested));
    const nextEnd = Math.min(duration, nextStart + Math.min(presetSeconds - silenceBefore, clipRange.end - nextStart));
    const content = nextEnd - nextStart;
    setClipStart(inputTime(nextStart));
    setClipEnd(inputTime(nextEnd));
    setSilenceAfter(Math.max(0, presetSeconds - silenceBefore - content));
  }

  function changeSourceEnd(value: string) {
    if (previewingClip) cancelClipPreview();
    if (value === "") {
      setClipEnd(value);
      return;
    }
    const requested = Number(value);
    if (!Number.isFinite(requested)) return;
    const maximumEnd = Math.min(duration, clipRange.start + presetSeconds - silenceBefore);
    const nextEnd = Math.max(clipRange.start + MIN_AUDIO_SECONDS, Math.min(maximumEnd, requested));
    const content = nextEnd - clipRange.start;
    setClipEnd(inputTime(nextEnd));
    setSilenceAfter(Math.max(0, presetSeconds - silenceBefore - content));
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
    const startPosition = clipPosition >= presetSeconds ? 0 : clipPosition;
    const audioEndPosition = presetSeconds - silenceAfter;
    resumeTimeRef.current = range.start;
    setPreviewingClip(true);
    setClipPosition(startPosition);
    audio.pause();
    if (startPosition < silenceBefore) {
      audio.currentTime = range.start;
      setCurrentTime(range.start);
      playSilence(startPosition, silenceBefore, () => void startClipAudio(audio, range, range.start));
      return;
    }
    if (startPosition < audioEndPosition) {
      await startClipAudio(audio, range, range.start + startPosition - silenceBefore);
      return;
    }
    audio.currentTime = range.end;
    setCurrentTime(range.end);
    playSilence(startPosition, presetSeconds, finishClipPreview);
  }

  async function startClipAudio(audio: HTMLAudioElement, range: { start: number; end: number }, sourceTime: number) {
    previewTimerRef.current = null;
    clipPreviewRangeRef.current = range;
    audio.currentTime = sourceTime;
    setCurrentTime(sourceTime);
    const fadeInGain = fadeInSeconds > 0 ? Math.min(1, Math.max(0, (sourceTime - range.start) / fadeInSeconds)) : 1;
    const fadeOutGain = fadeOutSeconds > 0 ? Math.min(1, Math.max(0, (range.end - sourceTime) / fadeOutSeconds)) : 1;
    audio.volume = volume * Math.min(fadeInGain, fadeOutGain);
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

  function playSilence(from: number, to: number, onComplete: () => void) {
    if (previewTimerRef.current !== null) window.clearInterval(previewTimerRef.current);
    if (to <= from) {
      setClipPosition(to);
      onComplete();
      return;
    }
    const startedAt = performance.now();
    setClipPosition(from);
    previewTimerRef.current = window.setInterval(() => {
      const next = Math.min(to, from + (performance.now() - startedAt) / 1000);
      setClipPosition(next);
      if (next >= to) {
        if (previewTimerRef.current !== null) window.clearInterval(previewTimerRef.current);
        previewTimerRef.current = null;
        onComplete();
      }
    }, 30);
  }

  function cancelClipPreview(pauseAudio = true) {
    if (previewTimerRef.current !== null) window.clearInterval(previewTimerRef.current);
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
    audio.currentTime = range.end;
    setCurrentTime(range.end);
    clipPreviewRangeRef.current = null;
    if (silenceAfter > 0) {
      playSilence(presetSeconds - silenceAfter, presetSeconds, finishClipPreview);
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
      startSeconds: range.start,
      endSeconds: range.end,
      contentDurationSeconds: range.end - range.start,
      silenceBeforeSeconds: silenceBefore,
      silenceAfterSeconds: silenceAfter,
      outputDurationSeconds: presetSeconds,
      fadeInSeconds,
      fadeOutSeconds,
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
      startSeconds: range.start,
      endSeconds: range.end,
      contentDurationSeconds: range.end - range.start,
      silenceBeforeSeconds: silenceBefore,
      silenceAfterSeconds: silenceAfter,
      outputDurationSeconds: presetSeconds,
      fadeInSeconds,
      fadeOutSeconds,
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
        clipPosition={clipPosition}
        duration={duration}
        layout={clipLayout}
        outputDuration={presetSeconds}
        startValue={clipStart}
        endValue={clipEnd}
        previewing={previewingClip}
        exportingAudio={audioExportState === "exporting"}
        exportingVideo={videoExportState === "exporting"}
        disabled={disabled}
        displayGain={displayGain}
        presetSeconds={presetSeconds}
        audioFormat={audioFormat}
        fadeInSeconds={fadeInSeconds}
        fadeOutSeconds={fadeOutSeconds}
        exportedAudioPath={exportedAudioPath}
        exportedVideoPath={exportedVideoPath}
        onLayoutChange={setClipLayout}
        onSeek={seek}
        onClipSeek={seekClip}
        onPreview={() => void previewClip()}
        onReset={resetClip}
        onStartInput={changeSourceStart}
        onEndInput={changeSourceEnd}
        onDisplayGainChange={setDisplayGain}
        onPresetSeconds={applyPresetSeconds}
        onAudioFormatChange={setAudioFormat}
        onFadeInChange={changeFadeIn}
        onFadeOutChange={changeFadeOut}
        onExportAudio={exportAudio}
        onExportVideo={exportVideo}
        onReveal={onReveal}
      />
    </section>
  );
}
