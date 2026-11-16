/**
 * Reads the text on an ID photo inside the browser with Tesseract (open source, WebAssembly). The image is only handed to
 * the local worker: it is never posted anywhere. A failure throws, and the screen carries on by hand.
 */
export async function readIdPhoto(imageUrl: string): Promise<string> {
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("eng");
  try {
    const { data } = await worker.recognize(imageUrl);
    return data.text;
  } finally {
    await worker.terminate().catch(() => {});
  }
}
