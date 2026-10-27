import { useEffect, useRef, useState, type FormEvent } from "react";
import { api } from "./api.js";
import type { Anchor } from "../shared/schema.js";
const asset = (j: string, s: any) => `/api/journeys/${j}/assets/${s.assetId}`;
function Input({ label, ...props }: any) {
  return (
    <label>
      {label}
      <input {...props} />
    </label>
  );
}
export function App() {
  const [session, setSession] = useState<any>(null),
    [loaded, setLoaded] = useState(false),
    [error, setError] = useState(""),
    [journeys, setJourneys] = useState<any[]>([]),
    [journey, setJourney] = useState<any>(null),
    [versionId, setVersionId] = useState(""),
    [screen, setScreen] = useState(""),
    [editor, setEditor] = useState(false),
    [share, setShare] = useState(""),
    [grants, setGrants] = useState<any[]>([]),
    [agentToken, setAgentToken] = useState("");
  const [token] = useState(
    () => new URLSearchParams(location.hash.slice(1)).get("review") ?? "",
  );
  const [invite, setInvite] = useState(
    () => new URLSearchParams(location.hash.slice(1)).get("invite") ?? "",
  );
  const [secret, setSecret] = useState(""),
    [name, setName] = useState(""),
    [memberToken, setMemberToken] = useState(""),
    [newMemberToken, setNewMemberToken] = useState("");
  const owner = session?.role === "owner";
  const v =
    journey?.versions.find((v: any) => v.id === versionId) ??
    journey?.versions.at(-1);
  const step = v?.steps.find((s: any) => s.id === screen);
  const previous =
    v &&
    journey.versions[journey.versions.findIndex((x: any) => x.id === v.id) - 1];
  const refresh = async (id = journey?.id) => {
    const list = await api("/journeys");
    setJourneys(list);
    if (id) {
      const next = await api(`/journeys/${id}`);
      setJourney(next);
      if (id !== journey?.id) {
        setShare("");
        setAgentToken("");
        setScreen("");
        setVersionId("");
        setEditor(false);
      }
      if (owner) setGrants(await api(`/journeys/${id}/grants`));
    }
  };
  const action = async (fn: () => Promise<any>) => {
    setError("");
    try {
      return await fn();
    } catch (e) {
      setError((e as Error).message);
      return null;
    }
  };
  useEffect(() => {
    if (token || invite) {
      history.replaceState(null, "", location.pathname);
      setLoaded(true);
      return;
    }
    api("/session")
      .then(async (s) => {
        setSession(s);
        const list = await api("/journeys");
        setJourneys(list);
        if (s.journey) setJourney(await api(`/journeys/${s.journey}`));
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);
  useEffect(() => {
    if (!session || !journey) return;
    const timer = setInterval(() => {
      api(`/journeys/${journey.id}`)
        .then(setJourney)
        .catch((e) => setError(e.message));
    }, 4000);
    return () => clearInterval(timer);
  }, [session, journey?.id]);
  const login = async (e: FormEvent) => {
    e.preventDefault();
    await action(async () => {
      const s = invite
        ? await api("/members/redeem", { invite })
        : memberToken
          ? await api("/members/sign-in", { token: memberToken })
          : await api(
              token ? "/join" : "/login",
              token ? { token, name } : { secret },
            );
      if (s.memberToken) setNewMemberToken(s.memberToken);
      setInvite("");
      setSession(s);
      setSecret("");
      setMemberToken("");
      const list = await api("/journeys");
      setJourneys(list);
      if (s.journey) setJourney(await api(`/journeys/${s.journey}`));
    });
  };
  if (!loaded)
    return (
      <main className="access">
        <p>Opening the review…</p>
      </main>
    );
  if (!session)
    return (
      <main className="access">
        <div className="wordmark">◫ State Gallery</div>
        <div className="access-card">
          <span className="eyebrow">
            {invite ? "Member invite" : token ? "Shared review" : "Your studio"}
          </span>
          <h1>
            {invite
              ? "Join the project."
              : token
                ? "A fresh pair of eyes."
                : "See the whole journey."}
          </h1>
          <p>
            {invite
              ? "Accept to join as the member the owner named. This invite works once."
              : token
                ? "Join with a display name to leave feedback. Shared links identify a guest, not a verified account."
                : "Review the screens, discuss the details, and decide what to build."}
          </p>
          <form onSubmit={login}>
            {invite ? null : token ? (
              <Input
                label="Your display name"
                value={name}
                onChange={(e: any) => setName(e.target.value)}
                required
                maxLength={100}
              />
            ) : (
              <Input
                label="Installation secret"
                type="password"
                value={secret}
                onChange={(e: any) => setSecret(e.target.value)}
                required
              />
            )}
            <button>
              {invite ? "Accept invite" : token ? "Join review" : "Open studio"}
            </button>
          </form>
          {!invite && !token && (
            <details>
              <summary>Sign in with a member token</summary>
              <form onSubmit={login}>
                <Input
                  label="Member token"
                  type="password"
                  value={memberToken}
                  onChange={(e: any) => setMemberToken(e.target.value)}
                  required
                />
                <button>Sign in as member</button>
              </form>
            </details>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </div>
        <p className="small">A quiet place for products taking shape.</p>
      </main>
    );
  return (
    <>
      <header>
        <a className="wordmark" href="/">
          ◫ State Gallery
        </a>
        <span className="small">
          {owner
            ? "Owner studio"
            : session.role === "member"
              ? `Member · ${session.name}`
              : `Reviewing as ${session.name}`}
        </span>
        <button
          className="ghost"
          onClick={() =>
            action(async () => {
              await api("/logout", {});
              setSession(null);
              setJourney(null);
            })
          }
        >
          Sign out
        </button>
      </header>
      <main>
        {error && (
          <div className="error" role="alert">
            {error}
            <button className="ghost" onClick={() => setError("")}>
              Dismiss
            </button>
          </div>
        )}
        {newMemberToken && (
          <div className="panel" role="status">
            <h2>Your member token</h2>
            <p>
              Shown once. Use it for <code>loop link</code> and to sign in on
              another browser. Keep it private.
            </p>
            <Input label="Member token" readOnly value={newMemberToken} />
            <button className="ghost" onClick={() => setNewMemberToken("")}>
              I have saved it
            </button>
          </div>
        )}
        {!journey ? (
          <>
            <div className="intro">
              <span className="eyebrow">Journey library</span>
              <h1>
                From first screen
                <br />
                to final decision.
              </h1>
              <p>Keep the experience in view as your product takes shape.</p>
            </div>
            <div className="library">
              {journeys.map((j) => (
                <button
                  className="journey-card"
                  key={j.id}
                  onClick={() => action(() => refresh(j.id))}
                >
                  <span className="eyebrow">{j.versions.length} versions</span>
                  <h2>{j.title}</h2>
                  <span>
                    {j.authorization ? "Approved for build" : "Open for review"}{" "}
                    →
                  </span>
                </button>
              ))}
            </div>
            {owner && (
              <form
                className="new-journey"
                onSubmit={(e) => {
                  e.preventDefault();
                  const title = new FormData(e.currentTarget).get("title");
                  action(async () => {
                    const j = await api("/journeys", { title });
                    await refresh(j.id);
                    setEditor(true);
                  });
                }}
              >
                <Input
                  label="New journey title"
                  name="title"
                  placeholder="e.g. First-time checkout"
                  required
                  maxLength={200}
                />
                <button>Create journey</button>
              </form>
            )}
          </>
        ) : (
          <>
            <div className="journey-head">
              <div>
                <button
                  className="breadcrumb"
                  onClick={() => {
                    setJourney(null);
                    setScreen("");
                  }}
                >
                  ← Journeys
                </button>
                <span className="eyebrow">An experience in progress</span>
                <h1>{journey.title}</h1>
                <p>
                  {v
                    ? `${v.steps.length} steps · ${v.coverage} capture coverage`
                    : "Add your first screens to start a review."}
                </p>
              </div>
              <div className="toolbar">
                <label>
                  Version
                  <select
                    aria-label="Version"
                    value={v?.id ?? ""}
                    onChange={(e) => {
                      setVersionId(e.target.value);
                      setScreen("");
                    }}
                  >
                    {journey.versions.map((x: any, i: number) => (
                      <option value={x.id} key={x.id}>
                        Version {i + 1}
                        {x.id === journey.currentId ? " · current" : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  className="ghost"
                  onClick={() => action(() => refresh())}
                >
                  Refresh
                </button>
                {owner && (
                  <button onClick={() => setEditor(!editor)}>
                    {editor ? "Close draft" : v ? "Add version" : "Add screens"}
                  </button>
                )}
              </div>
            </div>
            {journey.authorization && (
              <div className="approval">
                ✓ Approved for build{" "}
                <span>
                  Version{" "}
                  {journey.versions.findIndex(
                    (x: any) => x.id === journey.authorization.versionId,
                  ) + 1}{" "}
                  · review generation {journey.authorization.generation}
                </span>
              </div>
            )}
            {editor && owner && (
              <VersionEditor
                journey={journey}
                onSubmit={(manifest: any, assets: any, key: string) =>
                  action(async () => {
                    const next = await api(`/journeys/${journey.id}/versions`, {
                      manifest,
                      assets,
                      submissionKey: key,
                    });
                    await refresh();
                    setVersionId(next.id);
                    setEditor(false);
                    setScreen("");
                    return true;
                  })
                }
              />
            )}
            {v && (
              <>
                <nav className="view-nav">
                  <button
                    className={!step ? "selected" : "ghost"}
                    onClick={() => setScreen("")}
                  >
                    Journey overview
                  </button>
                  {v.steps.map((s: any, i: number) => (
                    <button
                      key={s.id}
                      className={screen === s.id ? "selected" : "ghost"}
                      onClick={() => setScreen(s.id)}
                    >
                      {i + 1}. {s.title}
                    </button>
                  ))}
                </nav>
                {step ? (
                  <ScreenReview
                    key={`${v.id}-${step.id}`}
                    journey={journey}
                    version={v}
                    step={step}
                    previous={previous}
                    owner={owner}
                    refresh={refresh}
                    action={action}
                  />
                ) : (
                  <div className="steps">
                    {v.steps.map((s: any, i: number) => (
                      <article key={s.id} className="step-card">
                        <div className="step-label">
                          <span className="step-number">
                            {String(i + 1).padStart(2, "0")}
                          </span>
                          <span className={`badge ${s.kind}`}>
                            {s.kind === "capture"
                              ? "Working capture"
                              : s.kind === "gap"
                                ? "Screen gap"
                                : "Mockup"}
                          </span>
                          <span className="small">
                            {s.viewport.width} × {s.viewport.height}
                          </span>
                        </div>
                        <button
                          className="preview"
                          aria-label={`Open ${s.title}`}
                          onClick={() => setScreen(s.id)}
                        >
                          {s.assetId ? (
                            <img src={asset(journey.id, s)} alt={s.title} />
                          ) : (
                            <div className="gap">
                              {s.outcome === "failed"
                                ? "Capture failed"
                                : "Screen to come"}
                              <small>
                                {s.provenance ||
                                  "This step is intentionally visible without an image."}
                              </small>
                            </div>
                          )}
                        </button>
                        <h2>{s.title}</h2>
                        <p>{s.purpose}</p>
                        <div className="transition">
                          {s.transition || "End of this step"} →
                        </div>
                      </article>
                    ))}
                  </div>
                )}
                {Object.keys(v.responses ?? {}).length > 0 && (
                  <section className="panel">
                    <h2>Revision response</h2>
                    <p>
                      Claims from the agent. Feedback stays open until the owner
                      resolves it.
                    </p>
                    {Object.entries(v.responses).map(([id, text]) => (
                      <p key={id}>
                        <strong>
                          {journey.comments.find((c: any) => c.id === id)
                            ?.text ?? id}
                        </strong>
                        <br />
                        {String(text)}
                      </p>
                    ))}
                  </section>
                )}
              </>
            )}
            {owner && (
              <section className="owner-panel">
                <div className="panel">
                  <h2>Review decisions</h2>
                  <p>
                    Decisions apply to the current version. All open feedback,
                    including earlier versions, needs a deliberate resolution.
                  </p>
                  <div className="button-row">
                    <button
                      disabled={!v || v.id !== journey.currentId}
                      onClick={() =>
                        action(async () => {
                          await api(`/journeys/${journey.id}/requests`, {
                            versionId: v.id,
                            generation: journey.generation,
                          });
                          await refresh();
                        })
                      }
                    >
                      Request revision
                    </button>
                    <button
                      className="approve-button"
                      disabled={!v || v.id !== journey.currentId}
                      onClick={() =>
                        action(async () => {
                          await api(`/journeys/${journey.id}/approve`, {
                            versionId: v.id,
                            generation: journey.generation,
                          });
                          await refresh();
                        })
                      }
                    >
                      Approve for build
                    </button>
                  </div>
                  {journey.requests.length > 0 && (
                    <div className="request-card">
                      <strong>Latest revision request</strong>
                      <code>{journey.requests.at(-1).id}</code>
                      <Input
                        label="Agent handoff command"
                        readOnly
                        value={`state-gallery export ${journey.id} ${journey.requests.at(-1).id} ./review-pass`}
                      />
                      <button
                        className="ghost"
                        onClick={() =>
                          action(() =>
                            navigator.clipboard.writeText(
                              `state-gallery export ${journey.id} ${journey.requests.at(-1).id} ./review-pass`,
                            ),
                          )
                        }
                      >
                        Copy agent handoff
                      </button>
                      <p>
                        {journey.requests.at(-1).comments.length} feedback
                        threads snapshotted ·{" "}
                        {journey.requests.at(-1).successorId
                          ? "revision received"
                          : "waiting for your agent"}
                      </p>
                      <p className="small">
                        Give the request ID to your existing agent. Export it
                        with the CLI.
                      </p>
                    </div>
                  )}
                  <h3>
                    Open feedback ·{" "}
                    {journey.comments.filter((c: any) => !c.resolved).length}
                  </h3>
                  {journey.comments
                    .filter((c: any) => !c.resolved)
                    .map((c: any) => (
                      <div className="queue" key={c.id}>
                        <button
                          className="text-button"
                          onClick={() => {
                            setVersionId(c.versionId);
                            setScreen(c.stepId);
                          }}
                        >
                          {c.text}
                          <span className="small">
                            {c.author} · version{" "}
                            {journey.versions.findIndex(
                              (v: any) => v.id === c.versionId,
                            ) + 1}{" "}
                            · {c.stepId}
                          </span>
                        </button>
                        <button
                          className="ghost"
                          onClick={() =>
                            action(async () => {
                              await api(
                                `/journeys/${journey.id}/comments/${c.id}/resolve`,
                                {
                                  resolved: true,
                                  generation: journey.generation,
                                },
                              );
                              await refresh();
                            })
                          }
                        >
                          Resolve
                        </button>
                      </div>
                    ))}
                </div>
                <div className="panel">
                  <h2>Invite a collaborator</h2>
                  <p>
                    A link gives access to this journey. Guests choose their
                    display names.
                  </p>
                  <label>
                    Link expires
                    <input
                      id="expiry"
                      type="datetime-local"
                      defaultValue={new Date(Date.now() + 7 * 86400000)
                        .toISOString()
                        .slice(0, 16)}
                    />
                  </label>
                  <button
                    onClick={() =>
                      action(async () => {
                        const expiresAt = new Date(
                          (
                            document.getElementById(
                              "expiry",
                            ) as HTMLInputElement
                          ).value,
                        ).getTime();
                        const g = await api(`/journeys/${journey.id}/grants`, {
                          role: "reviewer",
                          expiresAt,
                        });
                        setShare(`${location.origin}/#review=${g.token}`);
                        await refresh();
                      })
                    }
                  >
                    Create reviewer link
                  </button>
                  {share && (
                    <div className="secret">
                      <Input label="Review link" readOnly value={share} />
                      <button
                        className="ghost"
                        onClick={() =>
                          action(() => navigator.clipboard.writeText(share))
                        }
                      >
                        Copy link
                      </button>
                    </div>
                  )}
                  <button
                    className="ghost"
                    onClick={() =>
                      action(async () => {
                        const g = await api(`/journeys/${journey.id}/grants`, {
                          role: "agent",
                        });
                        setAgentToken(g.token);
                        await refresh();
                      })
                    }
                  >
                    Create agent credential
                  </button>
                  {agentToken && (
                    <div className="secret">
                      <Input
                        label="Agent token — shown once"
                        readOnly
                        value={agentToken}
                      />
                      <p className="small">
                        Store privately as STATE_GALLERY_TOKEN. Agent
                        credentials cannot approve builds.
                      </p>
                    </div>
                  )}
                  {grants.map((g) => (
                    <div className="grant" key={g.id}>
                      <span>
                        {g.role} ·{" "}
                        {g.revoked
                          ? "revoked"
                          : new Date(g.expiresAt).toLocaleDateString()}
                      </span>
                      {!g.revoked && (
                        <button
                          className="ghost"
                          onClick={() =>
                            action(async () => {
                              await api(
                                `/journeys/${journey.id}/grants/${g.id}/revoke`,
                                {},
                              );
                              await refresh();
                            })
                          }
                        >
                          Revoke
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </main>
      <footer>State Gallery · Space to see what comes next.</footer>
    </>
  );
}
function VersionEditor({ journey, onSubmit }: any) {
  const [steps, setSteps] = useState<any[]>(
      () =>
        journey.versions.at(-1)?.steps.map((s: any) => ({
          ...s,
          image: undefined,
          assetId: undefined,
        })) ?? [],
    ),
    [assets, setAssets] = useState<any>({}),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const key = useRef(crypto.randomUUID());
  const parent = useRef(journey.currentId);
  const initial = useRef(journey.versions.at(-1));
  const [reuseReady, setReuseReady] = useState(!initial.current);
  useEffect(() => {
    if (!initial.current) return;
    Promise.all(
      initial.current.steps.map(async (s: any) => {
        if (!s.assetId) return;
        const r = await fetch(asset(journey.id, s));
        if (!r.ok)
          throw new Error(
            "Could not load the previous images. Reopen the draft.",
          );
        const bytes = new Uint8Array(await r.arrayBuffer());
        let binary = "";
        for (const byte of bytes) binary += String.fromCharCode(byte);
        return { name: `${s.id}-retained`, bytes: btoa(binary), id: s.id };
      }),
    )
      .then((items) => {
        const retained = Object.fromEntries(
          items.filter(Boolean).map((a: any) => [a.name, a.bytes]),
        );
        setAssets((a: any) => ({ ...retained, ...a }));
        setSteps((a) =>
          a.map((s) => ({
            ...s,
            image: s.image ?? items.find((a: any) => a?.id === s.id)?.name,
          })),
        );
        setReuseReady(true);
      })
      .catch((e) => setError(e.message));
  }, []);
  const update = (i: number, p: any) =>
    setSteps((s) => s.map((v, k) => (i === k ? { ...v, ...p } : v)));
  const add = () =>
    setSteps((s) => [
      ...s,
      {
        id: `step-${crypto.randomUUID().slice(0, 8)}`,
        title: "New screen",
        purpose: "",
        transition: "",
        kind: "mockup",
        viewport: { width: 1440, height: 900 },
        outcome: "captured",
        provenance: "",
      },
    ]);
  const upload = async (i: number, f: File) => {
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result).split(",")[1]);
        r.onerror = () => reject(new Error("Could not read this image"));
        r.readAsDataURL(f);
      });
      const image = `${steps[i].id}-${f.name}`;
      setAssets((a: any) => ({ ...a, [image]: base64 }));
      update(i, { image, outcome: "captured" });
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <section className="panel editor">
      <span className="eyebrow">New immutable version</span>
      <h2>Arrange the experience.</h2>
      <p>
        Your saved versions stay intact. Replace the visuals for this draft, or
        mark a deliberate gap.
      </p>
      {steps.map((s, i) => (
        <div className="draft-step" key={s.id}>
          <div className="draft-heading">
            <strong>Step {i + 1}</strong>
            <button
              className="ghost"
              disabled={i === 0}
              onClick={() =>
                setSteps((a) => {
                  const b = [...a];
                  [b[i - 1], b[i]] = [b[i], b[i - 1]];
                  return b;
                })
              }
            >
              Move up
            </button>
            <button
              className="ghost"
              onClick={() => setSteps((a) => a.filter((_, k) => k !== i))}
            >
              Remove
            </button>
          </div>
          <div className="fields">
            <Input
              label="Stable step ID"
              value={s.id}
              onChange={(e: any) => update(i, { id: e.target.value })}
            />
            <Input
              label="Screen title"
              value={s.title}
              onChange={(e: any) => update(i, { title: e.target.value })}
            />
            <label>
              Visual type
              <select
                value={s.kind}
                onChange={(e) =>
                  update(i, {
                    kind: e.target.value,
                    outcome: e.target.value === "gap" ? "missing" : "captured",
                    image: undefined,
                  })
                }
              >
                <option value="mockup">Mockup</option>
                <option value="capture">Working capture</option>
                <option value="gap">Deliberate gap</option>
              </select>
            </label>
            <Input
              label="Purpose"
              value={s.purpose}
              onChange={(e: any) => update(i, { purpose: e.target.value })}
            />
            <Input
              label="Transition to next step"
              value={s.transition}
              onChange={(e: any) => update(i, { transition: e.target.value })}
            />
            <Input
              label="Viewport width"
              type="number"
              value={s.viewport.width}
              onChange={(e: any) =>
                update(i, {
                  viewport: { ...s.viewport, width: Number(e.target.value) },
                })
              }
            />
            <Input
              label="Viewport height"
              type="number"
              value={s.viewport.height}
              onChange={(e: any) =>
                update(i, {
                  viewport: { ...s.viewport, height: Number(e.target.value) },
                })
              }
            />
            <Input
              label="Capture / visual provenance"
              value={s.provenance}
              onChange={(e: any) => update(i, { provenance: e.target.value })}
            />
            {s.kind !== "gap" && (
              <Input
                label={`Image for step ${i + 1}`}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(e: any) =>
                  e.target.files[0] && upload(i, e.target.files[0])
                }
              />
            )}
          </div>
          {s.image && <p className="small">Ready: {s.image}</p>}
        </div>
      ))}
      <div className="button-row">
        <button className="ghost" onClick={add}>
          + Add step
        </button>
        <button
          disabled={busy || !steps.length || !reuseReady}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              const success = await onSubmit(
                {
                  schemaVersion: 1,
                  parentId: parent.current ?? undefined,
                  steps,
                },
                Object.fromEntries(
                  steps
                    .filter((s) => s.image)
                    .map((s) => [s.image, assets[s.image]]),
                ),
                key.current,
              );
              if (!success)
                setError(
                  "Draft preserved. Correct the error above and submit again.",
                );
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Saving…" : "Submit version"}
        </button>
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </section>
  );
}
function ScreenReview({
  journey,
  version,
  step,
  previous,
  owner,
  refresh,
  action,
}: any) {
  const [tool, setTool] = useState<"screen" | "point" | "region">("screen"),
    [anchor, setAnchor] = useState<Anchor>({ kind: "screen" }),
    [text, setText] = useState(""),
    [compare, setCompare] = useState(false);
  const start = useRef<{ x: number; y: number } | null>(null);
  const image = useRef<HTMLDivElement>(null);
  const coords = (e: React.PointerEvent) => {
    const r = image.current!.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
      y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)),
    };
  };
  const comments = journey.comments.filter(
    (c: any) => c.versionId === version.id && c.stepId === step.id,
  );
  const predecessor = previous?.steps.find((s: any) => s.id === step.id);
  return (
    <section>
      <div className="screen-heading">
        <div>
          <span className="eyebrow">
            {step.kind} · {step.viewport.width} × {step.viewport.height}
          </span>
          <h2>{step.title}</h2>
          <p>{step.purpose}</p>
        </div>
        {previous && (
          <button className="ghost" onClick={() => setCompare(!compare)}>
            {compare ? "Close comparison" : "Compare with previous"}
          </button>
        )}
      </div>
      {compare && (
        <div className="comparison">
          <div>
            <h3>Previous version</h3>
            {predecessor?.assetId ? (
              <img
                src={asset(journey.id, predecessor)}
                alt={`Previous ${step.title}`}
              />
            ) : (
              <p>No matching screen in the previous version.</p>
            )}
          </div>
          <div>
            <h3>Selected version</h3>
            {step.assetId ? (
              <img
                src={asset(journey.id, step)}
                alt={`Selected ${step.title}`}
              />
            ) : (
              <p>Screen gap</p>
            )}
          </div>
        </div>
      )}
      <div className="screen-layout">
        <div>
          <div className="annotation-tools" aria-label="Comment location">
            {(["screen", "point", "region"] as const).map((t) => (
              <button
                key={t}
                className={tool === t ? "selected" : "ghost"}
                onClick={() => {
                  setTool(t);
                  setAnchor({ kind: "screen" });
                }}
              >
                {t === "screen"
                  ? "Whole screen"
                  : t === "point"
                    ? "Pin a point"
                    : "Mark a region"}
              </button>
            ))}
          </div>
          <p className="small">
            {tool === "screen"
              ? "Write a note about this screen."
              : tool === "point"
                ? "Click the image to place your pin."
                : "Drag across the image to mark an area."}
          </p>
          {step.assetId ? (
            <div
              ref={image}
              className={`annotated ${tool}`}
              style={{
                maxWidth: step.width ?? step.viewport.width,
                marginInline: "auto",
              }}
              onPointerDown={(e) => {
                if (tool === "screen") return;
                start.current = coords(e);
                e.currentTarget.setPointerCapture(e.pointerId);
                if (tool === "point")
                  setAnchor({ kind: "point", ...start.current });
              }}
              onPointerUp={(e) => {
                if (tool === "region" && start.current) {
                  const end = coords(e),
                    s = start.current;
                  const width = Math.abs(end.x - s.x),
                    height = Math.abs(end.y - s.y);
                  if (width > 0 && height > 0)
                    setAnchor({
                      kind: "region",
                      x: Math.min(s.x, end.x),
                      y: Math.min(s.y, end.y),
                      width,
                      height,
                    });
                }
                start.current = null;
              }}
            >
              <img
                draggable={false}
                src={asset(journey.id, step)}
                alt={step.title}
              />
              {comments.map((c: any, i: number) => (
                <Marker anchor={c.anchor} key={c.id} label={String(i + 1)} />
              ))}
              <Marker anchor={anchor} label="+" draft />
            </div>
          ) : (
            <div className="gap">
              {step.outcome === "failed" ? "Capture failed" : "Screen gap"}
              <small>{step.provenance}</small>
            </div>
          )}
          <p className="small">{step.provenance}</p>
        </div>
        <aside className="discussion">
          <h3>Discussion · {comments.length}</h3>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              action(async () => {
                await api(`/journeys/${journey.id}/comments`, {
                  versionId: version.id,
                  stepId: step.id,
                  text,
                  anchor,
                });
                setText("");
                setAnchor({ kind: "screen" });
                await refresh();
              });
            }}
          >
            <label>
              New comment
              <textarea
                required
                maxLength={4000}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="What should change, and why?"
              />
            </label>
            <p className="small">
              Attached to{" "}
              {anchor.kind === "screen"
                ? "the whole screen"
                : anchor.kind === "point"
                  ? "your pin"
                  : "your marked region"}{" "}
              in this exact version.
            </p>
            <button>Save comment</button>
          </form>
          {comments.map((c: any, i: number) => (
            <Comment
              key={c.id}
              comment={c}
              number={i + 1}
              journeyId={journey.id}
              owner={owner}
              generation={journey.generation}
              action={action}
              refresh={refresh}
            />
          ))}
        </aside>
      </div>
    </section>
  );
}
function Marker({ anchor, label, draft = false }: any) {
  if (anchor.kind === "screen") return null;
  return (
    <span
      aria-label={`${draft ? "Draft" : "Comment"} ${label} ${anchor.kind}`}
      className={`marker ${anchor.kind} ${draft ? "draft" : ""}`}
      style={{
        left: `${anchor.x * 100}%`,
        top: `${anchor.y * 100}%`,
        ...(anchor.kind === "region"
          ? {
              width: `${anchor.width * 100}%`,
              height: `${anchor.height * 100}%`,
            }
          : {}),
      }}
    >
      {label}
    </span>
  );
}
function Comment({
  comment: c,
  number,
  journeyId,
  owner,
  generation,
  action,
  refresh,
}: any) {
  const [reply, setReply] = useState("");
  return (
    <article className={`comment ${c.resolved ? "resolved" : ""}`}>
      <div className="comment-meta">
        <strong>
          {number}. {c.author}
        </strong>
        <span>{c.resolved ? "Resolved" : c.anchor.kind}</span>
      </div>
      <p>{c.text}</p>
      {c.replies.map((r: any) => (
        <div className="reply" key={r.id}>
          <strong>{r.author}</strong>
          <p>{r.text}</p>
        </div>
      ))}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          action(async () => {
            await api(`/journeys/${journeyId}/comments/${c.id}/replies`, {
              text: reply,
            });
            setReply("");
            await refresh();
          });
        }}
      >
        <Input
          label={`Reply to comment ${number}`}
          value={reply}
          onChange={(e: any) => setReply(e.target.value)}
          required
          maxLength={4000}
        />
        <button className="ghost">Reply</button>
      </form>
      {owner && (
        <button
          className="ghost"
          onClick={() =>
            action(async () => {
              await api(`/journeys/${journeyId}/comments/${c.id}/resolve`, {
                resolved: !c.resolved,
                generation,
              });
              await refresh();
            })
          }
        >
          {c.resolved ? "Reopen feedback" : "Resolve feedback"}
        </button>
      )}
    </article>
  );
}
