import { gatewayFileStorage } from "@/lib/gateway";

const MAX_BYTES = 15 * 1024 * 1024;

/** Reads a stored Return photo from our own file storage so it can be fingerprinted here. */
export async function fetchReturnPhoto(fileId: string): Promise<Uint8Array> {
  const url = new URL(await gatewayFileStorage.viewUrl(fileId));
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("Storage address must be HTTPS");
  const response = await fetch(url, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error("Photo could not be read");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length > MAX_BYTES) throw new Error("Photo is too large");

  return bytes;
}
