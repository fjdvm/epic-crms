import type { FileInfo } from "./policy";

export interface StoredFile extends FileInfo {
  id: string; status: string; visibility: "public" | "private"; retentionType: "temporary" | "permanent"; url: string;
}
/** Only JSON metadata crosses the gateway. File bytes go to/from the storage-signed address. */
async function call<T>(path: string, method = "GET", body?: object): Promise<T> {
  const base = process.env.CREOMS_GATEWAY_URL;
  const key = process.env.CREOMS_GATEWAY_CALLER_KEY;
  if (!base || !key) throw new Error("File storage is not configured");
  const response = await fetch(`${base.replace(/\/$/, "")}/files${path}`, {
    method, headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}), cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw Object.assign(new Error("File storage refused the request"), { status: response.status });
  return (response.status === 204 ? undefined : await response.json()) as T;
}
export const directFileStorage = {
  request: (file: FileInfo & { visibility: string; retentionType: string }) => call<{ id: string; uploadUrl: string }>("", "POST", file),
  confirm: (id: string) => call<StoredFile>(`/${encodeURIComponent(id)}/confirm`, "POST"),
  view: (id: string) => call<StoredFile>(`/${encodeURIComponent(id)}`),
  remove: (id: string) => call<void>(`/${encodeURIComponent(id)}`, "DELETE"),
};
export function storageUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("Storage address must be HTTPS");
  return url.toString();
}
