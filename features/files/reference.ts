import { createHmac, timingSafeEqual } from "node:crypto";
import type { FileInfo, UploadContext, UploadModule } from "./policy";

export interface UploadReference extends FileInfo {
  fileId: string;
  module: UploadModule;
  staffId: string;
  context: UploadContext;
  phase: "pending" | "ready";
  expires: number;
}
function signature(body: string) {
  const secret = process.env.CREOMS_UPLOAD_SECRET || process.env.CREOMS_SERVICE_SECRET;
  if (!secret || secret.length < 32) throw new Error("Upload signing key is not configured");
  return createHmac("sha256", secret).update(`creoms:direct-upload:v1:${body}`).digest("base64url");
}
export function sealUpload(value: UploadReference): string {
  const body = Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${body}.${signature(body)}`;
}
export function openUpload(reference: unknown): UploadReference | null {
  if (typeof reference !== "string" || reference.length > 8192) return null;
  const parts = reference.split(".");
  if (parts.length !== 2) return null;
  const [body, signed] = parts;
  const expected = signature(body);
  const received = Buffer.from(signed);
  const wanted = Buffer.from(expected);
  if (received.length !== wanted.length || !timingSafeEqual(received, wanted)) return null;
  try {
    const value = JSON.parse(Buffer.from(body, "base64url").toString()) as UploadReference;
    return value && typeof value.fileId === "string" && typeof value.expires === "number" && value.expires > Date.now() ? value : null;
  } catch { return null; }
}
