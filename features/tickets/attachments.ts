/** A Message carries at most one JPG or PNG image of up to this many bytes. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export type ImageContentType = "image/jpeg" | "image/png";

/** The image a Staff member picked, as the server receives it. */
export interface ImageUpload {
  filename: string;
  bytes: Uint8Array;
}

export type ImageRefusal = "empty-image" | "image-too-large" | "invalid-image-type";

export const IMAGE_REFUSALS: Record<ImageRefusal, string> = {
  "empty-image": "That image is empty. Choose a JPG or PNG with something in it.",
  "image-too-large": "That image is over 5 MB. Choose a smaller JPG or PNG.",
  "invalid-image-type": "Only JPG or PNG images can be attached.",
};

const startsWith = (bytes: Uint8Array, signature: number[]) => signature.every((b, i) => bytes[i] === b);

/**
 * What the bytes really are, not what the browser claimed: a renamed PDF is refused. Returns the
 * content type to store the File under, or why the image is refused.
 */
export function checkImage(image: ImageUpload): { ok: true; contentType: ImageContentType } | { ok: false; reason: ImageRefusal } {
  if (image.bytes.length === 0) return { ok: false, reason: "empty-image" };
  if (image.bytes.length > MAX_IMAGE_BYTES) return { ok: false, reason: "image-too-large" };
  if (startsWith(image.bytes, [0xff, 0xd8, 0xff])) return { ok: true, contentType: "image/jpeg" };
  if (startsWith(image.bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { ok: true, contentType: "image/png" };
  }

  return { ok: false, reason: "invalid-image-type" };
}

/**
 * The file-storage boundary, reached through the api-gateway (see lib/gateway.ts). Tests replace it
 * with a fake. Every File is Private and Permanent.
 */
export interface FileStorage {
  /** Stores the bytes as an Active Private File and returns its id. */
  upload(file: { filename: string; contentType: ImageContentType; bytes: Uint8Array }): Promise<string>;
  /** Labels the File as belonging to a Message. */
  linkToMessage(fileId: string, messageId: number): Promise<void>;
  /** A short-lived signed address to show the File from. */
  viewUrl(fileId: string): Promise<string>;
  remove(fileId: string): Promise<void>;
}
