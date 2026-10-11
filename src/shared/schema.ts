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
