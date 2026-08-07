import { convertFileSrc } from "@tauri-apps/api/core";
import {
  AudioWaveform,
  Disc3,
  FolderOpen,
  Mic2,
  Music2,
  Pause,
  Play,
  Volume2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { QueueItem } from "../types";

type PreviewTrack = "original" | "vocals" | "instrumental";

export function formatPlayerTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${Math.floor(seconds % 60).toString().padStart(2, "0")}`;
}

function mediaSource(path: string): string {
  return "__TAURI_INTERNALS__" in window ? convertFileSrc(path) : path;
}

interface ResultPlayerProps {
  item: QueueItem | null;
  onReveal: (path: string) => void;
}

export function ResultPlayer({ item, onReveal }: ResultPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const resumeTimeRef = useRef(0);
  const resumePlaybackRef = useRef(false);
  const [track, setTrack] = useState<PreviewTrack>("vocals");
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.85);
  const [audioError, setAudioError] = useState(false);

  const tracks = useMemo(() => ({
    original: item?.path,
    vocals: item?.outputs?.[0],
    instrumental: item?.outputs?.[1],
  }), [item]);
  const activePath = tracks[track] ?? "";

  useEffect(() => {
    resumeTimeRef.current = 0;
    resumePlaybackRef.current = false;
    setTrack("vocals");
    setPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setAudioError(false);
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

  if (!item || !item.outputs?.length) {
    return (
      <section className="result-player result-player-empty" aria-label="Result preview">
        <div className="result-empty-icon"><AudioWaveform size={22} /></div>
        <div>
          <span className="eyebrow">RESULT MONITOR</span>
          <strong>Preview appears when a track is complete</strong>
          <small>Compare the original, isolated vocal, and instrumental without leaving SPLTR.</small>
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
        <input
          className="seek-slider"
          type="range"
          min={0}
          max={Math.max(duration, 0)}
          step={0.05}
          value={Math.min(currentTime, duration || 0)}
          onChange={(event) => seek(Number(event.target.value))}
          aria-label="Preview position"
        />
        <span className="timecode">{formatPlayerTime(duration)}</span>
        <Volume2 size={15} className="volume-icon" />
        <input
          className="volume-slider"
          type="range"
          min={0}
          max={1}
          step={0.02}
          value={volume}
          onChange={(event) => changeVolume(Number(event.target.value))}
          aria-label="Preview volume"
        />
      </div>
    </section>
  );
}
