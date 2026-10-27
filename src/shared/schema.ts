import { z } from "zod";
const text = z.string().trim().min(1).max(4000);
export const anchorSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("screen") }),
  z.object({
    kind: z.literal("point"),
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
  }),
  z
    .object({
      kind: z.literal("region"),
      x: z.number().min(0).max(1),
      y: z.number().min(0).max(1),
      width: z.number().positive().max(1),
      height: z.number().positive().max(1),
    })
    .refine(
      (a) => a.x + a.width <= 1 && a.y + a.height <= 1,
      "Region must fit inside image",
    ),
]);
export const manifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    title: text.optional(),
    parentId: z.string().optional(),
    requestId: z.string().optional(),
    coverage: z.enum(["complete", "partial", "unknown"]).default("unknown"),
    expected: z.array(z.string()).max(2000).optional(),
    responses: z.record(z.string(), z.string().max(4000)).default({}),
    steps: z
      .array(
        z.object({
          id: z.string().regex(/^[\w.-]{1,100}$/),
          title: text,
          purpose: z.string().max(4000).default(""),
          transition: z.string().max(4000).default(""),
          kind: z.enum(["mockup", "capture", "gap"]),
          viewport: z.object({
            width: z.number().int().positive().max(20000),
            height: z.number().int().positive().max(20000),
          }),
          outcome: z
            .enum(["captured", "missing", "failed"])
            .default("captured"),
          image: z.string().max(500).optional(),
          provenance: z.string().max(4000).default(""),
          tags: z.array(z.string().max(2000)).max(20).default([]),
        }),
      )
      .min(1)
      .max(2000),
  })
  .superRefine((m, c) => {
    if (new Set(m.steps.map((s) => s.id)).size !== m.steps.length)
      c.addIssue({ code: "custom", message: "Duplicate step IDs" });
    for (const s of m.steps)
      if (s.kind !== "gap" && s.outcome === "captured" && !s.image)
        c.addIssue({ code: "custom", message: `Missing image for ${s.id}` });
    if (m.expected && new Set(m.expected).size !== m.expected.length)
      c.addIssue({ code: "custom", message: "Duplicate expected IDs" });
    if (
      m.coverage === "complete" &&
      (!m.expected?.length ||
        m.expected.length !== m.steps.length ||
        m.steps.some(
          (s) =>
            s.kind === "gap" ||
            s.outcome !== "captured" ||
            !s.image ||
            !m.expected!.includes(s.id),
        ))
    )
      c.addIssue({
        code: "custom",
        message:
          "Complete coverage requires an explicit expected inventory and captured images for every step",
      });
  });
export type Manifest = z.infer<typeof manifestSchema>;
export type Anchor = z.infer<typeof anchorSchema>;
const id = z.string().regex(/^[\w.:-]{1,200}$/);
const atMs = z.number().int().min(0).max(86_400_000);
export const pinInputSchema = z.object({ id, anchor: anchorSchema, atMs });
export const noteInputSchema = z
  .object({
    versionId: z.string().min(1).max(200),
    stepId: z.string().min(1).max(100),
    mediaId: z.string().min(1).max(200),
    medium: z.enum(["audio", "video"]),
    pins: z.array(pinInputSchema).max(500),
  })
  .refine(
    (n) => new Set(n.pins.map((p) => p.id)).size === n.pins.length,
    "Duplicate pin IDs",
  );
export const processingSchema = z.object({
  transcript: z.string().max(500_000),
  summary: z.string().max(20_000),
  proposals: z
    .array(
      z.object({
        pinId: id,
        quote: z.string().max(4000),
        proposal: text,
        anchor: anchorSchema.optional(),
        atMs: atMs.optional(),
      }),
    )
    .max(500),
});
export const decisionInputSchema = z.object({
  expected: z.string().max(200).nullable(),
  status: z.enum(["approved", "changed", "dropped"]),
  text: z.string().max(4000).optional(),
});
const titled = z.object({ title: text, ref: z.string().max(500).optional() });
export const turnInputSchema = z.object({
  loopTurnId: id,
  parentIds: z.array(id).max(50),
  inputs: z.array(titled).max(500),
  outputs: z
    .array(titled.extend({ kind: z.enum(["image", "other"]) }))
    .max(500),
  reactionNoteIds: z.array(z.string().max(200)).max(500),
  versionId: z.string().max(200).nullable(),
  notAVersionReason: z.string().trim().min(1).max(4000).nullable(),
});
export const shelfInputSchema = z.object({
  itemId: id,
  reason: z.string().max(4000),
});
