import { tmpdir } from "node:os";

/** Runs the open-source OCR (Tesseract) on the server, as the storefront does in the browser. Never throws past the caller's timeout; the image is not sent anywhere. */
export async function readImageText(image: Uint8Array, timeoutMs = 30_000): Promise<string> {
  const { createWorker } = await import("tesseract.js");
  // The runtime user cannot write to the app folder, so the English language data is cached in the temp folder.
  const worker = await createWorker("eng", 1, { cachePath: tmpdir() });
  const timer = setTimeout(() => void worker.terminate().catch(() => undefined), timeoutMs);
  try {
    const { data } = await worker.recognize(Buffer.from(image));
    return data.text;
  } finally {
    clearTimeout(timer);
    await worker.terminate().catch(() => undefined);
  }
}
