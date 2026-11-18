import { IMAGE_REFUSALS, MAX_IMAGE_BYTES } from "@/features/tickets/attachments";

/** Files supported by Ticket Messages; other record types may narrow this list. */
export const FILE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp", "application/pdf", "video/mp4", "video/quicktime"] as const;
export type FileContentType = (typeof FILE_TYPES)[number];
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export type UploadModule = "Tickets" | "Fulfilment" | "Returns" | "Management";
export interface FileInfo { filename: string; contentType: FileContentType; size: number }
export interface UploadContext { ticketId: number | null }
export type FileFailure = { ok: false; reason: string; cleanupFailed?: boolean };
export type ReadyFile = { ok: true; reference: string } & FileInfo;

export function filePolicy(module: UploadModule) {
  return { visibility: "private" as const,
    retentionType: module === "Fulfilment" || module === "Returns" ? "temporary" as const : "permanent" as const };
}
export const isUploadModule = (value: unknown): value is UploadModule =>
  ["Tickets", "Fulfilment", "Returns", "Management"].includes(value as string);

export function checkFileInfo(module: UploadModule, file: FileInfo): string | null {
  if (!file || typeof file.filename !== "string" || !file.filename.trim() || file.filename.length > 255) return "Choose a file with a name of at most 255 characters.";
  if (module === "Fulfilment" || module === "Returns" || module === "Management") {
    if (file.size === 0) return IMAGE_REFUSALS["empty-image"];
    if (file.size > MAX_IMAGE_BYTES) return IMAGE_REFUSALS["image-too-large"];
    if (file.contentType !== "image/jpeg" && file.contentType !== "image/png") return IMAGE_REFUSALS["invalid-image-type"];
  }
  if (!Number.isSafeInteger(file.size) || file.size <= 0) return "That file is empty. Choose a file with something in it.";
  if (file.size > MAX_FILE_BYTES) return "That file is over 25 MB. Choose a smaller file.";
  if (!(FILE_TYPES as readonly string[]).includes(file.contentType)) return "Choose a JPG, PNG, GIF, WebP, PDF, MP4 or MOV file.";
  if (module !== "Tickets" && !file.contentType.startsWith("image/")) return "This record accepts images only.";
  return null;
}
