import { useEffect, useState } from "react";
import { api, ApiError } from "./api.js";
import type { PinDecision, Pin, VideoNote } from "../shared/model.js";

export const time = (at: number) =>
  new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const VERB = { approved: "Approved", changed: "Changed", dropped: "Dropped" };

/** "Amadeo already approved this at 14:02" — the decision that stands after a refused one. */
export const conflictLine = (d: PinDecision) =>
  `${d.memberName} already ${d.status} this at ${time(d.at)}`;

/** The pins of a step's notes, numbered in the order they are listed and drawn on the image. */
export function stepPins(notes: VideoNote[]) {
  return notes.flatMap((note) => note.pins.map((pin) => ({ note, pin })));
}

export function NotesPanel({
  journeyId,
  notes,
  selected,
  onSelect,
  onChanged,
}: {
  journeyId: string;
  notes: VideoNote[];
  selected: string | null;
  onSelect: (pinId: string | null) => void;
  onChanged: () => Promise<void>;
}) {
  if (!notes.length) return null;
  const numbered = stepPins(notes);
  return (
    <section className="video-notes">
      <h3>Video notes · {notes.length}</h3>
      {notes.map((note) => (
        <article className="video-note" key={note.id}>
          <div className="comment-meta">
            <strong>{note.recorderName}</strong>
            <span>
              {note.medium === "video" ? "Screen recording" : "Voice note"} ·{" "}
              {time(note.createdAt)}
            </span>
          </div>
          {note.status === "unprocessed" && (
            <p className="small waiting">
              Waiting for {note.recorderName}'s Loop
            </p>
          )}
          {note.summary && <p>{note.summary}</p>}
          {note.pins.map((pin) => {
            const n = numbered.findIndex((x) => x.pin.id === pin.id) + 1;
            const open = selected === pin.id;
            return (
              <div key={pin.id}>
                <button
                  className={`pin-row ${open ? "selected" : "ghost"}`}
                  aria-expanded={open}
                  onClick={() => onSelect(open ? null : pin.id)}
                >
                  <span className="pin-number">{n}</span>
                  <span className="pin-title">
                    {pin.proposal?.proposal ?? `Comment ${n}`}
                  </span>
                  <span className="pin-status">
                    {pin.decision
                      ? VERB[pin.decision.status]
                      : note.status === "unprocessed"
                        ? "Waiting"
                        : "Open"}
                  </span>
                </button>
                {open && (
                  <PinDetail
                    journeyId={journeyId}
                    note={note}
                    pin={pin}
                    number={n}
                    onChanged={onChanged}
                  />
                )}
              </div>
            );
          })}
        </article>
      ))}
    </section>
  );
}

function PinDetail({
  journeyId,
  note,
  pin,
  number,
  onChanged,
}: {
  journeyId: string;
  note: VideoNote;
  pin: Pin;
  number: number;
  onChanged: () => Promise<void>;
}) {
  const [history, setHistory] = useState<PinDecision[]>([]),
    [editing, setEditing] = useState(false),
    [text, setText] = useState(pin.proposal?.proposal ?? ""),
    [busy, setBusy] = useState(false),
    [conflict, setConflict] = useState<PinDecision | null>(null),
    [error, setError] = useState("");
  const loadHistory = () =>
    api(`/journeys/${journeyId}/pins/${pin.id}/history`)
      .then((r) => setHistory(r.decisions))
      .catch((e) => setError(e.message));
  useEffect(() => {
    loadHistory();
  }, [pin.id, pin.decision?.id]);
  // A refused decision shows the one that stands until a refresh brings it in.
  const current =
    conflict && conflict.id !== pin.decision?.id ? conflict : pin.decision;
  const decide = async (status: PinDecision["status"], change?: string) => {
    setBusy(true);
    setError("");
    try {
      await api(`/journeys/${journeyId}/pins/${pin.id}/decisions`, {
        expected: current?.id ?? null,
        status,
        ...(change === undefined ? {} : { text: change }),
      });
      setConflict(null);
      setEditing(false);
      await onChanged();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && e.data?.current)
        setConflict(e.data.current);
      else setError((e as Error).message);
    } finally {
      setBusy(false);
      loadHistory();
    }
  };
  const processed = note.status === "processed";
  return (
    <div className="pin-detail" aria-label={`Comment ${number}`}>
      {pin.proposal ? (
        <>
          <blockquote>“{pin.proposal.quote}”</blockquote>
          <p>
            <span className="eyebrow">Proposed change</span>
            {pin.proposal.proposal}
          </p>
        </>
      ) : processed ? (
        <p className="small">No change was proposed for this comment.</p>
      ) : null}
      {conflict && conflict.id !== pin.decision?.id && (
        <p className="error" role="alert">
          {conflictLine(conflict)}
        </p>
      )}
      {current && (
        <p className="decision" role="status">
          <strong>
            {VERB[current.status]} by {current.memberName}
          </strong>{" "}
          at {time(current.at)}
          {current.text && current.status === "changed" && (
            <>
              <br />
              {current.text}
            </>
          )}
        </p>
      )}
      {pin.requestId ? (
        <p className="small">
          In a revision request; this comment can't be decided again.
        </p>
      ) : (
        processed && (
          <>
            {editing ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  decide("changed", text);
                }}
              >
                <label>
                  Changed text
                  <textarea
                    required
                    maxLength={4000}
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                  />
                </label>
                <div className="button-row">
                  <button disabled={busy}>Save change</button>
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => setEditing(false)}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              <div className="button-row">
                <button
                  disabled={busy || !pin.proposal}
                  onClick={() => decide("approved")}
                >
                  Approve
                </button>
                <button
                  className="ghost"
                  disabled={busy}
                  onClick={() => {
                    setText(current?.text ?? pin.proposal?.proposal ?? "");
                    setEditing(true);
                  }}
                >
                  Change
                </button>
                <button
                  className="ghost"
                  disabled={busy}
                  onClick={() => decide("dropped")}
                >
                  Drop
                </button>
              </div>
            )}
          </>
        )
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {history.length > 0 && (
        <ol className="decision-history" aria-label="Decision history">
          {history.map((d) => (
            <li key={d.id}>
              {VERB[d.status]} · {d.memberName} · {time(d.at)}
              {d.refused ? " · refused" : d.superseded ? " · replaced" : ""}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
