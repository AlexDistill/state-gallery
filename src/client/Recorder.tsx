import { useEffect, useRef, useState } from "react";
import { api, uploadMedia } from "./api.js";
import type { Anchor } from "../shared/schema.js";

type Box = { left: number; top: number; width: number; height: number };
type Size = { width: number; height: number };
type Point = { x: number; y: number };
export type DraftPin = { id: string; anchor: Anchor; atMs: number };

/** Mime types tried in order; Chromium and Firefox record WebM, Safari MP4. */
const AUDIO_TYPES = [
  "audio/webm;codecs=opus",
  "audio/mp4",
  "video/webm",
  "video/mp4",
];
const VIDEO_TYPES = ["video/webm", "video/mp4"];
export function probeMime(
  isTypeSupported: (type: string) => boolean,
  withVideo: boolean,
): string | null {
  return (
    (withVideo ? VIDEO_TYPES : AUDIO_TYPES).find((t) => isTypeSupported(t)) ??
    null
  );
}

/** Where the image is drawn inside its element box, allowing for object-fit letterboxing. */
export function contentBox(
  box: Box,
  natural: Size,
  fit: string,
  position: [number, number] = [0.5, 0.5],
): Box {
  if (
    (fit !== "contain" && fit !== "scale-down") ||
    !natural.width ||
    !natural.height
  )
    return {
      left: box.left,
      top: box.top,
      width: box.width,
      height: box.height,
    };
  let scale = Math.min(box.width / natural.width, box.height / natural.height);
  if (fit === "scale-down") scale = Math.min(scale, 1);
  const width = natural.width * scale,
    height = natural.height * scale;
  return {
    left: box.left + (box.width - width) * position[0],
    top: box.top + (box.height - height) * position[1],
    width,
    height,
  };
}

const round = (n: number) => Math.round(n * 10000) / 10000;
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/**
 * A pointer position as a fraction of the drawn image (0 to 1 on each axis).
 * Outside the image it is null, or pinned to the nearest edge when `clamp` is set.
 */
export function normalizePoint(
  clientX: number,
  clientY: number,
  box: Box,
  natural: Size,
  fit = "fill",
  position: [number, number] = [0.5, 0.5],
  clamp = false,
): Point | null {
  const c = contentBox(box, natural, fit, position);
  if (!c.width || !c.height) return null;
  const x = (clientX - c.left) / c.width,
    y = (clientY - c.top) / c.height;
  if (!clamp && (x < 0 || x > 1 || y < 0 || y > 1)) return null;
  return { x: round(clamp01(x)), y: round(clamp01(y)) };
}

/** A click (under `threshold` of movement) is a point pin; a drag is a region pin. */
export function pinFromGesture(
  start: Point,
  end: Point,
  threshold = 0.01,
): Anchor {
  const dx = Math.abs(end.x - start.x),
    dy = Math.abs(end.y - start.y);
  if (dx < threshold || dy < threshold)
    return { kind: "point", x: round(start.x), y: round(start.y) };
  const x = round(Math.min(start.x, end.x)),
    y = round(Math.min(start.y, end.y));
  let width = round(dx),
    height = round(dy);
  if (x + width > 1) width = round(width - 0.0001);
  if (y + height > 1) height = round(height - 0.0001);
  return { kind: "region", x, y, width, height };
}

/** Reads the image's object-fit and object-position so letterboxed images map correctly. */
function locate(
  e: { clientX: number; clientY: number },
  img: HTMLImageElement,
  clamp = false,
) {
  const style = getComputedStyle(img);
  const pos = style.objectPosition.split(/\s+/).map((v) => {
    const n = parseFloat(v);
    return v.endsWith("%") && Number.isFinite(n) ? n / 100 : 0.5;
  });
  return normalizePoint(
    e.clientX,
    e.clientY,
    img.getBoundingClientRect(),
    { width: img.naturalWidth, height: img.naturalHeight },
    style.objectFit,
    [pos[0] ?? 0.5, pos[1] ?? 0.5],
    clamp,
  );
}

type Phase = "idle" | "starting" | "recording" | "preview" | "uploading";
type Preview = {
  url: string;
  blob: Blob;
  durationMs: number;
  medium: "audio" | "video";
};
const TRACK_INTERVAL_MS = 50;

export function useRecorder() {
  const [phase, setPhase] = useState<Phase>("idle"),
    [pins, setPins] = useState<DraftPin[]>([]),
    [preview, setPreview] = useState<Preview | null>(null),
    [screen, setScreen] = useState(false),
    [error, setError] = useState("");
  const recorder = useRef<MediaRecorder | null>(null);
  const streams = useRef<MediaStream[]>([]);
  const startedAt = useRef(0);
  const stoppedAt = useRef(0);
  const track = useRef<{ t: number; x: number; y: number }[]>([]);
  const lastMove = useRef(-Infinity);
  const down = useRef<{ p: Point; t: number } | null>(null);
  const url = useRef("");
  const mounted = useRef(true);
  const elapsed = () => Math.round(performance.now() - startedAt.current);
  const stopStreams = () => {
    for (const s of streams.current) for (const t of s.getTracks()) t.stop();
    streams.current = [];
  };
  const clearPreview = () => {
    if (url.current) URL.revokeObjectURL(url.current);
    url.current = "";
    setPreview(null);
  };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (recorder.current && recorder.current.state !== "inactive") {
        recorder.current.onstop = null;
        recorder.current.stop();
      }
      stopStreams();
      if (url.current) URL.revokeObjectURL(url.current);
    };
  }, []);
  const start = async () => {
    setError("");
    clearPreview();
    setPhase("starting");
    try {
      const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
      streams.current = [mic];
      if (!mounted.current) return stopStreams();
      let tracks: MediaStreamTrack[] = mic.getAudioTracks();
      if (screen) {
        const display = await navigator.mediaDevices.getDisplayMedia({
          video: true,
        });
        streams.current.push(display);
        if (!mounted.current) return stopStreams();
        tracks = [...display.getVideoTracks(), ...tracks];
      }
      const mime = probeMime((t) => MediaRecorder.isTypeSupported(t), screen);
      if (!mime)
        throw new Error(
          "This browser can't record here. Try a recent Chrome, Firefox or Safari.",
        );
      const r = new MediaRecorder(new MediaStream(tracks), { mimeType: mime });
      const chunks: Blob[] = [];
      const medium = screen ? "video" : "audio";
      r.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data);
      };
      r.onstop = () => {
        stopStreams();
        const blob = new Blob(chunks, { type: r.mimeType || mime });
        url.current = URL.createObjectURL(blob);
        setPreview({
          url: url.current,
          blob,
          durationMs: stoppedAt.current - startedAt.current,
          medium,
        });
        setPhase("preview");
      };
      track.current = [];
      lastMove.current = -Infinity;
      setPins([]);
      r.start(1000);
      startedAt.current = performance.now();
      recorder.current = r;
      setPhase("recording");
    } catch (e) {
      stopStreams();
      setPhase("idle");
      setError(
        (e as Error).name === "NotAllowedError"
          ? "Recording needs microphone access. Allow it in the browser, then try again."
          : (e as Error).message,
      );
    }
  };
  const stop = () => {
    stoppedAt.current = performance.now();
    down.current = null;
    recorder.current?.stop();
  };
  const discard = () => {
    clearPreview();
    setPins([]);
    track.current = [];
    setPhase("idle");
  };
  const upload = async (
    journeyId: string,
    versionId: string,
    stepId: string,
  ) => {
    if (!preview) return false;
    setError("");
    setPhase("uploading");
    try {
      const media = await uploadMedia(journeyId, preview.blob);
      await api(`/journeys/${journeyId}/notes`, {
        versionId,
        stepId,
        mediaId: media.id,
        medium: preview.medium,
        pins,
        pointer: track.current,
      });
      discard();
      return true;
    } catch (e) {
      setPhase("preview");
      setError(
        `${(e as Error).message} Your recording is still here; try Upload again.`,
      );
      return false;
    }
  };
  const recording = phase === "recording";
  const pointer = {
    onPointerDown(e: React.PointerEvent, img: HTMLImageElement) {
      if (!recording) return;
      const p = locate(e, img);
      if (!p) return;
      down.current = { p, t: elapsed() };
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    onPointerMove(e: React.PointerEvent, img: HTMLImageElement) {
      if (!recording) return;
      const t = elapsed();
      if (t - lastMove.current < TRACK_INTERVAL_MS) return;
      const p = locate(e, img);
      if (!p) return;
      lastMove.current = t;
      track.current.push({ t, ...p });
    },
    onPointerUp(e: React.PointerEvent, img: HTMLImageElement) {
      const d = down.current;
      down.current = null;
      if (!recording || !d) return;
      const end = locate(e, img, true) ?? d.p;
      setPins((list) => [
        ...list,
        {
          id: crypto.randomUUID(),
          anchor: pinFromGesture(d.p, end),
          atMs: d.t,
        },
      ]);
    },
  };
  return {
    phase,
    pins,
    preview,
    screen,
    setScreen,
    error,
    start,
    stop,
    discard,
    upload,
    pointer,
    startedAt,
  };
}
export type Recorder = ReturnType<typeof useRecorder>;

const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export function RecorderPanel({
  rec,
  journeyId,
  versionId,
  stepId,
  onUploaded,
}: {
  rec: Recorder;
  journeyId: string;
  versionId: string;
  stepId: string;
  onUploaded: () => void;
}) {
  const [now, setNow] = useState(0);
  const media = useRef<HTMLMediaElement | null>(null);
  useEffect(() => {
    if (rec.phase !== "recording") return;
    const timer = setInterval(
      () => setNow(performance.now() - rec.startedAt.current),
      500,
    );
    return () => clearInterval(timer);
  }, [rec.phase]);
  const canCaptureScreen = !!navigator.mediaDevices?.getDisplayMedia;
  return (
    <div className="recorder" aria-label="Video note recorder">
      {rec.phase === "idle" || rec.phase === "starting" ? (
        <>
          <p className="small">Recordings here go to the shared project.</p>
          <div className="button-row">
            <button disabled={rec.phase === "starting"} onClick={rec.start}>
              {rec.phase === "starting" ? "Starting…" : "Record note"}
            </button>
            {canCaptureScreen && (
              <label className="check">
                <input
                  type="checkbox"
                  checked={rec.screen}
                  onChange={(e) => rec.setScreen(e.target.checked)}
                />
                Also capture my screen
              </label>
            )}
          </div>
        </>
      ) : rec.phase === "recording" ? (
        <>
          <p className="recording-status" role="status">
            <span className="dot" /> Recording · {clock(now)} ·{" "}
            {rec.pins.length} {rec.pins.length === 1 ? "comment" : "comments"}
          </p>
          <p className="small">
            Talk it through. Click the image to add a comment; drag to mark a
            region.
          </p>
          <button onClick={rec.stop}>Stop</button>
        </>
      ) : rec.preview ? (
        <>
          <h3>Watch it back</h3>
          {rec.preview.medium === "video" ? (
            <video
              ref={(el) => {
                media.current = el;
              }}
              controls
              src={rec.preview.url}
            />
          ) : (
            <audio
              ref={(el) => {
                media.current = el;
              }}
              controls
              src={rec.preview.url}
            />
          )}
          <div className="timeline" aria-label="Comments on the recording">
            {rec.pins.map((p, i) => (
              <button
                key={p.id}
                className="timeline-pin"
                aria-label={`Comment ${i + 1} at ${clock(p.atMs)}`}
                style={{
                  left: `${Math.min(100, (p.atMs / Math.max(1, rec.preview!.durationMs)) * 100)}%`,
                }}
                onClick={() => {
                  if (media.current) media.current.currentTime = p.atMs / 1000;
                }}
              >
                {i + 1}
              </button>
            ))}
          </div>
          <p className="small">
            {clock(rec.preview.durationMs)} · {rec.pins.length}{" "}
            {rec.pins.length === 1 ? "comment" : "comments"}. Uploading sends it
            to the shared project; your Loop processes it next.
          </p>
          <div className="button-row">
            <button
              disabled={rec.phase === "uploading"}
              onClick={async () => {
                if (await rec.upload(journeyId, versionId, stepId))
                  onUploaded();
              }}
            >
              {rec.phase === "uploading" ? "Uploading…" : "Upload"}
            </button>
            <button
              className="ghost"
              disabled={rec.phase === "uploading"}
              onClick={rec.discard}
            >
              Discard
            </button>
          </div>
        </>
      ) : null}
      {rec.error && (
        <p className="error" role="alert">
          {rec.error}
        </p>
      )}
    </div>
  );
}
