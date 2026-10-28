import { useEffect, useState } from "react";
import { api, ApiError } from "./api.js";
import type { PinDecision, Pin, VideoNote } from "../shared/model.js";

export const time = (at: number) =>
  new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const VERB = { approved: "Approved", changed: "Changed", dropped: "Dropped" };

/** A comment's row title: the changed text once decided as changed, else the proposal. */
export const pinTitle = (pin: Pin, n: number) =>
  (pin.decision?.status === "changed" && pin.decision.text) ||
  pin.proposal?.proposal ||
  `Comment ${n}`;

/** True when some decided comment is not yet in a revision request, so a request has something to send. */
export const hasUnsentDecisions = (notes: Pick<VideoNote, "pins">[]) =>
  notes.some((n) => n.pins.some((p) => p.decision && !p.requestId));

/** The pins of a step's notes, numbered in the order they are listed and drawn on the image. */
export function stepPins(notes: VideoNote[]) {
  return notes.flatMap((note) => note.pins.map((pin) => ({ note, pin })));
}

/** Comments in a note that "Yes, do it" can approve: processed, undecided, outside a request, with a proposal. */
export const openPins = (note: VideoNote) =>
  note.status === "processed"
    ? note.pins.filter((p) => !p.decision && !p.requestId && p.proposal)
    : [];

/**
 * Approves each open comment with the same call as its Approve button, one at a time.
 * A comment someone else decided first is refused by the server and left as it is.
 */
export async function approveAll(journeyId: string, pins: Pin[]) {
  let refused = 0;
  let failed = "";
  for (const pin of pins) {
    try {
      await api(`/journeys/${journeyId}/pins/${pin.id}/decisions`, {
        expected: null,
        status: "approved",
      });
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) refused++;
      else failed ||= (e as Error).message;
    }
  }
  return { refused, failed };
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
      <h3>Comments · {notes.length}</h3>
      {notes.map((note) => (
        <NoteItem
          key={note.id}
          journeyId={journeyId}
          note={note}
          numbered={numbered}
          selected={selected}
          onSelect={onSelect}
          onChanged={onChanged}
        />
      ))}
    </section>
  );
}

function NoteItem({
  journeyId,
  note,
  numbered,
  selected,
  onSelect,
  onChanged,
}: {
  journeyId: string;
  note: VideoNote;
  numbered: ReturnType<typeof stepPins>;
  selected: string | null;
  onSelect: (pinId: string | null) => void;
  onChanged: () => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const number = (pin: Pin) =>
    numbered.findIndex((x) => x.pin.id === pin.id) + 1;
  const open = openPins(note);
  const heard = note.status === "processed" && !!note.summary;
  // With comments still open, What I heard comes first and the rows wait behind Change it.
  const collapsible = heard && open.length > 0;
  const showRows =
    !collapsible || expanded || note.pins.some((p) => p.id === selected);
  const yes = async () => {
    setBusy(true);
    setMessage("");
    try {
      const { refused, failed } = await approveAll(journeyId, open);
      if (refused)
        setMessage(
          refused === 1
            ? "Someone else had already decided 1 comment, so it was left as it is."
            : `Someone else had already decided ${refused} comments, so they were left as they are.`,
        );
      else if (failed) setMessage(failed);
      await onChanged();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <article className="video-note">
      <div className="comment-meta">
        <strong>{note.recorderName}</strong>
        <span>
          {note.medium === "video" ? "Screen recording" : "Voice note"} ·{" "}
          {time(note.createdAt)}
        </span>
      </div>
      {note.status === "unprocessed" && (
        <p className="small waiting">Waiting for {note.recorderName}'s Mac</p>
      )}
      {heard ? (
        <div className="heard" aria-label="What I heard">
          <span className="eyebrow">What I heard</span>
          <p>{note.summary}</p>
          {note.pins.length > 0 && (
            <ol className="heard-list">
              {note.pins.map((pin) => (
                <li
                  key={pin.id}
                  className={
                    pin.decision?.status === "dropped" ? "dropped" : undefined
                  }
                >
                  <span className="pin-number">{number(pin)}</span>
                  <span className="heard-title">
                    {pinTitle(pin, number(pin))}
                  </span>
                  {pin.decision && (
                    <span className="heard-status">
                      {VERB[pin.decision.status]}
                    </span>
                  )}
                </li>
              ))}
            </ol>
          )}
          <div className="button-row">
            <button disabled={busy || open.length === 0} onClick={yes}>
              {busy ? "Approving…" : "Yes, do it"}
            </button>
            {collapsible && (
              <button
                className="ghost"
                aria-expanded={showRows}
                onClick={() => {
                  if (showRows) onSelect(null);
                  setExpanded(!showRows);
                }}
              >
                Change it
              </button>
            )}
          </div>
          {message && (
            <p className="small heard-message" role="status">
              {message}
            </p>
          )}
        </div>
      ) : (
        note.summary && <p>{note.summary}</p>
      )}
      {note.status === "processed" && note.mediaId && (
        <NotePlayer journeyId={journeyId} note={note} />
      )}
      {showRows &&
        note.pins.map((pin) => {
          const n = number(pin);
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
                  {pinTitle(pin, n)}
                  {pin.requestId && (
                    <span className="pin-request">In revision request</span>
                  )}
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
  );
}

/** Plays back a processed note's recording; its media is readable by every member once processed. */
function NotePlayer({
  journeyId,
  note,
}: {
  journeyId: string;
  note: VideoNote;
}) {
  const src = `/api/journeys/${encodeURIComponent(journeyId)}/media/${encodeURIComponent(note.mediaId!)}`;
  const label = `Play ${note.recorderName}'s ${note.medium === "video" ? "video" : "voice"} note`;
  return note.medium === "video" ? (
    <video
      className="note-player"
      controls
      preload="metadata"
      src={src}
      aria-label={label}
    />
  ) : (
    <audio
      className="note-player"
      controls
      preload="metadata"
      src={src}
      aria-label={label}
    />
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
    [conflict, setConflict] = useState<{
      current: PinDecision;
      message: string;
    } | null>(null),
    [error, setError] = useState("");
  const loadHistory = () =>
    api(`/journeys/${journeyId}/pins/${pin.id}/history`)
      .then((r) => setHistory(r.decisions))
      .catch((e) => setError(e.message));
  useEffect(() => {
    loadHistory();
  }, [pin.id, pin.decision?.id]);
  // A refused decision shows the one that stands until a refresh brings it in.
  const refused = conflict && conflict.current.id !== pin.decision?.id;
  const current = refused ? conflict.current : pin.decision;
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
        setConflict({ current: e.data.current, message: e.message });
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
      {refused && (
        <p className="error" role="alert">
          {conflict.message}
        </p>
      )}
      {current && (
        <p className="decision" role="status">
          <strong>
            {VERB[current.status]} by {current.memberName}
          </strong>{" "}
          at <span className="nowrap">{time(current.at)}</span>
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
        processed &&
        !refused && (
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
