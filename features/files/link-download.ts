import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";
import { fileTypeFromBuffer } from "file-type";
import { MAX_IMAGE_BYTES } from "@/features/tickets/attachments";
import { linkProblem } from "@/features/orders/dispatch-record";

/**
 * Downloads the proof image Staff copied from a Lalamove or Grab booking, so it can be stored like an uploaded
 * Delivery photo. The link is typed by Staff, so the server only talks to public https hosts: every resolved address
 * is checked and the connection is pinned to the checked address (no DNS rebinding), redirects are re-checked,
 * and the body is capped at the image limit.
 */

export const LINK_IMAGE_REASON = "That link didn't give us a JPG or PNG image. Save the image and upload it instead.";
export const LINK_UNREACHABLE_REASON = "We couldn't download the image from that link. Check the link, or save the image and upload it instead.";
export const LINK_TOO_LARGE_REASON = "The image at that link is over 5 MB. Save a smaller copy and upload it instead.";
export const LINK_INVALID_REASON = "Paste the image link as a web address starting with https://.";

const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 10_000;

const blocked = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 3],
] as const) blocked.addSubnet(network, prefix, "ipv4");
for (const [network, prefix] of [
  ["::", 128], ["::1", 128], ["64:ff9b::", 96], ["100::", 64], ["2001:db8::", 32], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8],
] as const) blocked.addSubnet(network, prefix, "ipv6");

/** True only for addresses on the public internet; private, loopback, link-local and cloud-metadata ones are refused. */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !blocked.check(address, "ipv4");
  if (family !== 6) return false;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (mapped) return isPublicAddress(mapped[1]);
  return !blocked.check(address, "ipv6");
}

type Resolve = (host: string, callback: (error: NodeJS.ErrnoException | null, addresses: LookupAddress[]) => void) => void;
const resolveAll: Resolve = (host, callback) => dnsLookup(host, { all: true, verbatim: true }, callback);

/** A `lookup` for the socket that resolves once and refuses unless every address is public. */
export function publicLookup(resolve: Resolve = resolveAll): LookupFunction {
  return (host, options, callback) => {
    resolve(host, (error, addresses) => {
      if (error) return callback(error, "", 4);
      if (!addresses.length || !addresses.every(entry => isPublicAddress(entry.address))) {
        return callback(Object.assign(new Error("Link resolves to a non-public address"), { code: "EPRIVATE" }), "", 4);
      }
      if ((options as { all?: boolean }).all) return (callback as unknown as (e: null, a: LookupAddress[]) => void)(null, addresses);
      callback(null, addresses[0].address, addresses[0].family);
    });
  };
}

export interface LinkResponse { status: number; location: string | null; body: AsyncIterable<Uint8Array>; cancel: () => void }
export type LinkFetcher = (url: URL) => Promise<LinkResponse>;

/** One https GET with no automatic redirects, through the public-only lookup. */
export const httpsFetcher: LinkFetcher = url => new Promise((resolve, reject) => {
  const request = httpsRequest(url, { method: "GET", lookup: publicLookup(), timeout: TIMEOUT_MS,
    headers: { Accept: "image/jpeg, image/png;q=0.9", "User-Agent": "CREOMS-delivery-proof" } }, response => {
    const location = response.headers.location;
    resolve({ status: response.statusCode ?? 0, location: typeof location === "string" ? location : null, body: response, cancel: () => response.destroy() });
  });
  request.on("timeout", () => request.destroy(new Error("Link timed out")));
  request.on("error", reject);
  request.end();
});

export type LinkImage = { ok: true; bytes: Uint8Array; contentType: "image/jpeg" | "image/png"; filename: string } | { ok: false; reason: string };

/** The bytes and real type of the JPG or PNG at the link, or what to tell Staff. */
export async function downloadLinkImage(link: string, fetcher: LinkFetcher = httpsFetcher): Promise<LinkImage> {
  const text = link.trim();
  if (!text || linkProblem(text)) return { ok: false, reason: LINK_INVALID_REASON };
  let url = new URL(text);
  const deadline = AbortSignal.timeout(TIMEOUT_MS * 2);
  try {
    for (let hop = 0; ; hop++) {
      if (url.protocol !== "https:" || url.username || url.password) return { ok: false, reason: LINK_UNREACHABLE_REASON };
      const hostname = url.hostname.replace(/^\[|\]$/g, "");
      if (isIP(hostname) && !isPublicAddress(hostname)) return { ok: false, reason: LINK_UNREACHABLE_REASON };
      const response = await fetcher(url);
      if (response.status >= 300 && response.status < 400 && response.location) {
        response.cancel();
        if (hop >= MAX_REDIRECTS) return { ok: false, reason: LINK_UNREACHABLE_REASON };
        url = new URL(response.location, url);
        continue;
      }
      if (response.status !== 200) { response.cancel(); return { ok: false, reason: LINK_UNREACHABLE_REASON }; }
      const chunks: Uint8Array[] = [];
      let size = 0;
      for await (const chunk of response.body) {
        if (deadline.aborted) { response.cancel(); return { ok: false, reason: LINK_UNREACHABLE_REASON }; }
        size += chunk.length;
        if (size > MAX_IMAGE_BYTES) { response.cancel(); return { ok: false, reason: LINK_TOO_LARGE_REASON }; }
        chunks.push(chunk);
      }
      if (size === 0) return { ok: false, reason: LINK_IMAGE_REASON };
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      const type = await fileTypeFromBuffer(bytes);
      const mime = type?.mime === "image/apng" ? "image/png" : type?.mime;
      if (mime !== "image/jpeg" && mime !== "image/png") return { ok: false, reason: LINK_IMAGE_REASON };
      return { ok: true, bytes, contentType: mime, filename: mime === "image/png" ? "delivery-proof.png" : "delivery-proof.jpg" };
    }
  } catch {
    return { ok: false, reason: LINK_UNREACHABLE_REASON };
  }
}
