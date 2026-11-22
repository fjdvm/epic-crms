import type { IdType } from "./verifications";

/** What the ID reader may flag on a Senior/PWD check. Each one is for a Manager to look at; none decides anything. */
export const ID_FLAGS = [
  "unreadable", "not-an-id", "possible-edit", "name-mismatch", "expired", "type-mismatch", "number-differs", "photo-reused",
] as const;
export type IdFlag = (typeof ID_FLAGS)[number];

export interface IdFindings {
  /** The holder's name as printed, or null when it could not be read. */
  name: string | null;
  /** Whether every word of the account name is on the ID; null when no name was read. */
  nameMatches: boolean | null;
  /** The printed expiry, `YYYY-MM-DD`, or null. */
  expiresOn: string | null;
  /** What kind of ID it looks like. */
  idKind: IdType | "other" | null;
  /** The model's short note on signs of editing, if it saw any. */
  editNote: string | null;
  /** Other verifications whose photo looks like this one. */
  reusedPhotoVerificationIds: number[];
}

/** One stored reading. The ID number is never part of it. */
export interface IdRead {
  verificationId: number;
  status: "read" | "needs-review";
  findings: IdFindings;
  flags: IdFlag[];
  model: string | null;
}

/** Each flag in plain words, as Staff and Managers read it on the check and in Approvals. */
export const ID_FLAG_TEXT: Record<IdFlag, string> = {
  "unreadable": "The photo could not be read. Check every detail by eye.",
  "not-an-id": "This may not be an ID card.",
  "possible-edit": "The photo may have been edited.",
  "name-mismatch": "The name on the ID does not match the account.",
  "expired": "The ID looks expired.",
  "type-mismatch": "The ID looks like a different type than the Customer chose.",
  "number-differs": "The number the Customer typed differs from the one read off the photo.",
  "photo-reused": "A photo like this one was sent from another account.",
};

/** What the check screen shows: the result, a read still running, or nothing yet. */
export type IdReadState = IdRead | { status: "reading" } | null;
