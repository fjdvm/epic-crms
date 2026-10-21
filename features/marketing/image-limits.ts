/** An image Staff add may be up to this many bytes before it is shrunk. */
export const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

/**
 * The file-storage boundary, reached through the api-gateway (see lib/gateway.ts). Tests replace it
 * with a fake. Every image is a Public, Permanent File so old emails keep displaying.
 */
export interface ImageStore {
  /** Stores the bytes and returns the public HTTPS address to show them from. */
  store(image: { contentType: "image/jpeg"; bytes: Uint8Array }): Promise<string>;
}

export type ImageRefusal = "empty-image" | "image-too-large" | "not-an-image";

export const IMAGE_REFUSALS: Record<ImageRefusal | "storage-unavailable", string> = {
  "empty-image": "That file is empty. Choose an image with something in it.",
  "image-too-large": "That image is over 25 MB. Choose a smaller one.",
  "not-an-image": "That file is not an image. Choose a JPG, PNG, WebP or GIF.",
  "storage-unavailable": "The image could not be stored. Try again in a moment.",
};

export type AddImageResult =
  | { ok: true; url: string }
  | { ok: false; reason: ImageRefusal | "storage-unavailable" };
