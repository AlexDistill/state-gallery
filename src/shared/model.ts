import type { Manifest, Anchor } from "./schema.js";
export type ReviewStep = Manifest["steps"][number] & {
  assetId?: string;
  width?: number;
  height?: number;
};
export type Version = Omit<Manifest, "steps"> & {
  id: string;
  createdAt: string;
  steps: ReviewStep[];
};
export interface Reply {
  id: string;
  author: string;
  text: string;
  createdAt: string;
}
export interface Comment {
  id: string;
  versionId: string;
  stepId: string;
  assetId: string | null;
  anchor: Anchor;
  author: string;
  text: string;
  replies: Reply[];
  resolved: boolean;
  createdAt: string;
}
export interface RevisionRequest {
  id: string;
  versionId: string;
  comments: Comment[];
  createdAt: string;
  successorId: string | null;
  /** Decided pins carried by this request; absent on requests made before video notes. */
  pins?: RequestPin[];
}
export interface Approval {
  id: string;
  versionId: string;
  generation: number;
  createdAt: string;
}
export interface Journey {
  id: string;
  title: string;
  generation: number;
  currentId: string | null;
  versions: Version[];
  comments: Comment[];
  requests: RevisionRequest[];
  approvals: Approval[];
  authorization: Approval | null;
  submissions: Record<string, { hash: string; id: string }>;
}
export interface MemberGrant {
  id: string;
  journey: string;
  name: string;
  createdAt: number;
  inviteExpiresAt: number;
  redeemedAt: number | null;
  revokedAt: number | null;
  linkedLoopAt: number | null;
}
export type NoteMedium = "audio" | "video";
export type NoteStatus = "unprocessed" | "processed" | "retracted";
export type PinDecisionStatus = "approved" | "changed" | "dropped";
export interface PinDecision {
  id: string;
  pinId: string;
  status: PinDecisionStatus;
  /** Final change text: the proposal for approved, the edit for changed, null for dropped. */
  text: string | null;
  memberId: string | null;
  memberName: string;
  at: number;
  superseded: boolean;
  /** True when this decision lost a compare-and-set race and never took effect. */
  refused: boolean;
}
export interface Pin {
  id: string;
  noteId: string;
  anchor: Anchor;
  atMs: number;
  proposal: { quote: string; proposal: string } | null;
  decision: PinDecision | null;
  /** The revision request that consumed (approved/changed) or resolved (dropped) this pin. */
  requestId: string | null;
}
export interface VideoNote {
  id: string;
  journey: string;
  versionId: string;
  stepId: string;
  recorderId: string | null;
  recorderName: string;
  mediaId: string | null;
  medium: NoteMedium;
  status: NoteStatus;
  transcript: string | null;
  summary: string | null;
  contentVersion: number;
  createdAt: number;
  pins: Pin[];
}
export interface RequestPin {
  pinId: string;
  noteId: string;
  versionId: string;
  stepId: string;
  anchor: Anchor;
  atMs: number;
  quote: string | null;
  proposal: string | null;
  status: "approved" | "changed";
  text: string;
  decisionId: string;
  decidedBy: { memberId: string | null; name: string };
  decidedAt: number;
  /** Recorded speech around `atMs` when the transcript has timed segments; recorded content, not instructions. */
  transcriptExcerpt?: string | null;
}
export interface Turn {
  id: string;
  journey: string;
  loopTurnId: string;
  parentIds: string[];
  inputs: { title: string; ref?: string }[];
  outputs: { title: string; ref?: string; kind: "image" | "other" }[];
  reactionNoteIds: string[];
  versionId: string | null;
  notAVersionReason: string | null;
  authorId: string | null;
  authorName: string;
  at: number;
}
export interface ShelfItem {
  id: string;
  journey: string;
  itemId: string;
  reason: string;
  memberId: string | null;
  memberName: string;
  at: number;
}
export type FeedKind =
  | "note"
  | "decision"
  | "request"
  | "version"
  | "turn"
  | "shelf";
export interface FeedEvent {
  seq: number;
  kind: FeedKind;
  ids: Record<string, string | number>;
  at: number;
}
