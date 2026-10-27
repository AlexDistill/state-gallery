import { useEffect, useState } from "react";
import { api } from "./api.js";
import type { ShelfItem, Turn, Version, VideoNote } from "../shared/model.js";

const day = (at: number) =>
  new Date(at).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

export function TurnsView({
  turns,
  shelf,
  versions,
  notes,
}: {
  turns: Turn[];
  shelf: ShelfItem[];
  versions: Pick<Version, "id">[];
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
                        {other.map((x, k) => (
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
              <strong>{s.itemId}</strong>
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
