import { useEffect, useState } from "react";
import { api } from "./api.js";
import type { ShelfItem, Turn, Version, VideoNote } from "../shared/model.js";

const day = (at: number) =>
  new Date(at).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

/**
 * A readable title for an item saved for later. Pushes carry only an id, so use a version
 * step's title when the id names one, keep a file name as it is, and otherwise turn
 * "testimonials-strip" into "Testimonials strip".
 */
export function shelfTitle(
  itemId: string,
  versions: { steps?: { id: string; title: string }[] }[],
) {
  for (const v of [...versions].reverse()) {
    const step = v.steps?.find((s) => s.id === itemId);
    if (step) return step.title;
  }
  const name = itemId.split(/[/:]/).pop() || itemId;
  if (/\.[a-z0-9]{1,5}$/i.test(name)) return name;
  const words = name.replace(/[-_.]+/g, " ").trim();
  return words ? words[0].toUpperCase() + words.slice(1) : itemId;
}

export function TurnsView({
  turns,
  shelf,
  versions,
  notes,
}: {
  turns: Turn[];
  shelf: ShelfItem[];
  versions: (Pick<Version, "id"> & Partial<Pick<Version, "steps">>)[];
  notes: Pick<VideoNote, "id" | "recorderName" | "summary">[];
}) {
  const versionNumber = (id: string) =>
    versions.findIndex((v) => v.id === id) + 1;
  const shelved = [...shelf].sort((a, b) => b.at - a.at);
  return (
    <div className="turns-view">
      <section className="panel">
        <h2>Rounds · {turns.length}</h2>
        <p>What went in, what came out and the reactions, in order.</p>
        {!turns.length && <p className="small">No rounds shared yet.</p>}
        <ol className="turn-list">
          {turns.map((t, i) => {
            const images = t.outputs.filter((o) => o.kind === "image");
            const other = t.outputs.filter((o) => o.kind !== "image");
            return (
              <li className="turn" key={t.id}>
                <div className="comment-meta">
                  <strong>
                    Round {i + 1} · {t.authorName}
                  </strong>
                  <span>{day(t.at)}</span>
                </div>
                {t.versionId ? (
                  <p className="small">
                    Became version {versionNumber(t.versionId) || t.versionId}
                    {images.length
                      ? ` · ${images.length} ${images.length === 1 ? "image" : "images"} as steps`
                      : ""}
                  </p>
                ) : t.notAVersionReason ? (
                  <p className="not-a-version">
                    <span className="badge gap">Not a version</span>{" "}
                    {t.notAVersionReason}
                  </p>
                ) : null}
                <div className="turn-columns">
                  <div>
                    <span className="eyebrow">Went in</span>
                    {t.inputs.length ? (
                      <ul>
                        {t.inputs.map((x, k) => (
                          <li key={k}>{x.title}</li>
                        ))}
                      </ul>
                    ) : (
                      <p className="small">Nothing listed</p>
                    )}
                  </div>
                  <div>
                    <span className="eyebrow">Came out</span>
                    {other.length || images.length ? (
                      <ul>
                        {(t.versionId ? t.outputs : other).map((x, k) => (
                          <li key={k} className="turn-output">
                            {x.title}
                          </li>
                        ))}
                        {images.length > 0 && !t.versionId && (
                          <li className="small">
                            {images.length}{" "}
                            {images.length === 1 ? "image" : "images"}, not
                            shown as a version
                          </li>
                        )}
                      </ul>
                    ) : (
                      <p className="small">Nothing listed</p>
                    )}
                  </div>
                  <div>
                    <span className="eyebrow">Reactions</span>
                    {t.reactionNoteIds.length ? (
                      <ul>
                        {t.reactionNoteIds.map((id) => {
                          const n = notes.find((x) => x.id === id);
                          return (
                            <li key={id}>
                              {n
                                ? `${n.recorderName}: ${n.summary ?? "video note"}`
                                : `Note ${id}`}
                            </li>
                          );
                        })}
                      </ul>
                    ) : (
                      <p className="small">No reaction notes</p>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      </section>
      <section className="panel">
        <h2>Later · {shelf.length}</h2>
        <p>Saved for later, with the reason.</p>
        {!shelved.length && <p className="small">Nothing saved for later.</p>}
        <ul className="shelf-list">
          {shelved.map((s) => (
            <li className="shelf-item" key={s.id}>
              <strong>{shelfTitle(s.itemId, versions)}</strong>
              <p>{s.reason || "No reason given"}</p>
              <span className="small">
                {s.memberName} · {day(s.at)}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

export function Turns({
  journey,
  notes,
  onError,
}: {
  journey: { id: string; latestSeq?: number; versions: Version[] };
  notes: VideoNote[];
  onError: (message: string) => void;
}) {
  const [data, setData] = useState<{ turns: Turn[]; shelf: ShelfItem[] }>({
    turns: [],
    shelf: [],
  });
  useEffect(() => {
    Promise.all([
      api(`/journeys/${journey.id}/turns`),
      api(`/journeys/${journey.id}/shelf`),
    ])
      .then(([t, s]) => setData({ turns: t.turns, shelf: s.shelf }))
      .catch((e) => onError(e.message));
  }, [journey.id, journey.latestSeq]);
  return (
    <TurnsView
      turns={data.turns}
      shelf={data.shelf}
      versions={journey.versions}
      notes={notes}
    />
  );
}
