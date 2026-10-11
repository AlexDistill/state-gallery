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
