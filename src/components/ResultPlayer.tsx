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
  Scissors,
  Video,
  Volume2,
} from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
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
  const [exportState, setExportState] = useState<ExportState>("idle");
  const [exportedPath, setExportedPath] = useState<string | null>(null);

  const tracks = useMemo(() => ({
    original: item?.path,
    vocals: item?.outputs?.[0],
    instrumental: item?.outputs?.[1],
  }), [item]);
  const activePath = tracks[track] ?? "";

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
    setExportState("idle");
    setExportedPath(null);
  }, [item?.id]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    audio.load();
    setPlaying(false);
    setCurrentTime(resumeTimeRef.current);
    setDuration(0);
    setAudioError(false);
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
      try {
        await audio.play();
      } catch {
        setAudioError(true);
      }
    } else {
      audio.pause();
    }
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

  function setRangePoint(point: "start" | "end") {
    setClipEdited(true);
    if (point === "start") setClipStart(inputTime(currentTime));
    else setClipEnd(inputTime(currentTime));
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
        onLoadedMetadata={(event) => void handleMetadata(event.currentTarget)}
        onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
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

      <div className="video-export">
        <div className="export-label"><Video size={15} /><span><strong>Vocal MP4</strong><small>854×480 black video · H.264/AAC</small></span></div>
        <label><span>START</span><input type="number" min="0" step="0.1" value={clipStart} onChange={(event) => { setClipEdited(true); setClipStart(event.target.value); }} /></label>
        <button className="mark-button" title="Set start to playhead" onClick={() => setRangePoint("start")}>IN</button>
        <label><span>END</span><input type="number" min="0" step="0.1" value={clipEnd} onChange={(event) => { setClipEdited(true); setClipEnd(event.target.value); }} /></label>
        <button className="mark-button" title="Set end to playhead" onClick={() => setRangePoint("end")}>OUT</button>
        <button className="export-button" disabled={disabled || exportState === "exporting"} onClick={exportVideo}>
          {exportState === "exporting" ? <LoaderCircle className="spin" size={14} /> : <Scissors size={14} />}
          {exportState === "exporting" ? "Exporting" : "Export MP4"}
        </button>
        {exportedPath && <button className="export-folder" aria-label="Show exported MP4 in folder" onClick={() => onReveal(exportedPath)}><FolderOpen size={14} /></button>}
      </div>
    </section>
  );
}
