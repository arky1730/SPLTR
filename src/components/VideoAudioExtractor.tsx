import { AudioLines, Check, Film, FolderOpen, LoaderCircle, X } from "lucide-react";
import { useEffect, useRef, useState, type DragEvent } from "react";
import { backend } from "../lib/backend";
import { fileName, newId } from "../lib/format";

type ExtractFormat = "wav" | "mp3";
type ExtractState = "idle" | "extracting" | "completed";

interface VideoAudioExtractorProps {
  disabled: boolean;
  outputLabel: string;
  droppedPath: string | null;
  onDroppedPathConsumed: () => void;
  onNotice: (message: string) => void;
  onReveal: (path: string) => void;
}

const VIDEO_EXTENSIONS = /\.(mp4|mov|mkv|avi|webm|m4v)$/i;

export function VideoAudioExtractor({ disabled, outputLabel, droppedPath, onDroppedPathConsumed, onNotice, onReveal }: VideoAudioExtractorProps) {
  const requestRef = useRef("");
  const [videoPath, setVideoPath] = useState("");
  const [format, setFormat] = useState<ExtractFormat>("wav");
  const [state, setState] = useState<ExtractState>("idle");
  const [outputPath, setOutputPath] = useState("");
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (!droppedPath) return;
    chooseVideo(droppedPath);
    onDroppedPathConsumed();
  }, [droppedPath, onDroppedPathConsumed]);

  useEffect(() => backend.subscribe((event) => {
    if (event.type !== "extract_video_audio" || event.requestId !== requestRef.current) return;
    if (event.state === "started") setState("extracting");
    if (event.state === "completed" && event.path) {
      setState("completed");
      setOutputPath(event.path);
      onNotice(`${(event.format ?? format).toUpperCase()} audio extracted from video.`);
    }
    if (event.state === "failed") {
      setState("idle");
      onNotice(event.message ?? "Could not extract audio from this video.");
    }
  }), [format, onNotice]);

  async function browseVideo() {
    const path = await backend.selectVideo();
    if (path) chooseVideo(path);
  }

  function chooseVideo(path: string) {
    if (!VIDEO_EXTENSIONS.test(path)) {
      onNotice("Choose an MP4, MOV, MKV, AVI, WebM, or M4V video.");
      return;
    }
    setVideoPath(path);
    setState("idle");
    setOutputPath("");
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0] as (File & { path?: string }) | undefined;
    if (file) chooseVideo(file.path ?? file.name);
  }

  function extract() {
    if (!videoPath || disabled || state === "extracting") return;
    const requestId = newId();
    requestRef.current = requestId;
    setState("extracting");
    setOutputPath("");
    void backend.send({ type: "extract_video_audio", requestId, path: videoPath, format }).catch(() => {
      setState("idle");
      onNotice("Could not start video audio extraction.");
    });
  }

  function clear() {
    if (state === "extracting") return;
    setVideoPath("");
    setOutputPath("");
    setState("idle");
  }

  return (
    <section className={`video-audio-tool ${dragging ? "dragging" : ""}`} aria-label="Extract audio from video">
      <div className="video-tool-head">
        <div className="video-tool-icon"><Film size={17} /></div>
        <div><span className="eyebrow">QUICK TOOL</span><strong>Video → Audio</strong><small>Extract locally with bundled FFmpeg</small></div>
        {videoPath && <button className="video-tool-clear" aria-label="Clear selected video" disabled={state === "extracting"} onClick={clear}><X size={13} /></button>}
      </div>

      <div
        className="video-tool-drop"
        onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
      >
        {videoPath ? (
          <><Film size={15} /><span><strong title={videoPath}>{fileName(videoPath)}</strong><small title={videoPath}>{videoPath}</small></span></>
        ) : (
          <><AudioLines size={16} /><span><strong>Drop a video or choose one</strong><small>MP4 · MOV · MKV · AVI · WEBM · M4V</small></span></>
        )}
        <button disabled={disabled || state === "extracting"} onClick={() => void browseVideo()}>{videoPath ? "Change" : "Choose video"}</button>
      </div>

      <div className="video-tool-actions">
        <label><span>FORMAT</span><select value={format} disabled={state === "extracting"} onChange={(event) => setFormat(event.target.value as ExtractFormat)}><option value="wav">WAV · 24-bit</option><option value="mp3">MP3 · 320k</option></select></label>
        <button className="video-extract-button" disabled={!videoPath || disabled || state === "extracting"} onClick={extract}>
          {state === "extracting" ? <LoaderCircle className="spin" size={14} /> : state === "completed" ? <Check size={14} /> : <AudioLines size={14} />}
          {state === "extracting" ? "Extracting" : state === "completed" ? "Extract again" : "Extract audio"}
        </button>
        {outputPath && <button className="video-output-folder" onClick={() => onReveal(outputPath)}><FolderOpen size={14} /> Folder</button>}
      </div>
      <div className="video-tool-output"><span>OUTPUT</span><strong title={outputLabel}>{outputLabel}</strong></div>
    </section>
  );
}
