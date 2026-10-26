import { sealUpload } from "@/features/files/reference";
import type { FileStorage, ImageContentType } from "@/features/tickets/attachments";

/** An in-memory file-storage: Private Files, short-lived addresses, and whatever failures a test asks for. */
export class FakeFileStorage implements FileStorage {
  files = new Map<string, { filename: string; contentType: string; size: number; link?: number; returnId?: number; visibility: "private" | "public"; retentionType: "permanent" | "temporary"; status: "active" | "pending"; bytes?: Uint8Array }>();
  failUpload = false;
  failLink = false;
  failRemove = false;
  failPromote = false;
  private next = 1;

  reset() {
    this.files.clear();
    this.failUpload = false;
    this.failLink = false;
    this.failRemove = false;
    this.failPromote = false;
    this.calls.length = 0;
    this.next = 1;
  }

  /** HTTP boundary shared by direct-upload server action tests; no real gateway or bucket. */
  calls: { url: string; method: string; authorization: string | null }[] = [];

  handle = async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    this.calls.push({ url: request.url, method: request.method, authorization: request.headers.get("authorization") });
    if (url.origin === "https://gateway.test" && url.pathname === "/files" && request.method === "POST") {
      if (this.failUpload) return new Response(null, { status: 503 });
      const body = await request.json();
      const id = `direct-${this.next++}`;
      this.files.set(id, { ...body, status: "pending" });
      return Response.json({ ...body, id, status: "pending", uploadUrl: `https://files.test/uploads/${id}` });
    }
    const id = url.pathname.split("/").filter(Boolean).at(url.pathname.endsWith("/confirm") || url.pathname.endsWith("/links") ? -2 : -1)!;
    const file = this.files.get(id);
    if (!file) return new Response(null, { status: 404 });
    if (url.origin === "https://files.test" && request.method === "PUT") {
      file.bytes = new Uint8Array(await request.arrayBuffer());
      return new Response(null, { status: 200 });
    }
    if (url.origin === "https://files.test" && request.method === "GET") {
      return new Response(file.bytes as BodyInit, { headers: { "Content-Type": file.contentType } });
    }
    if (url.origin !== "https://gateway.test") throw new Error("Unexpected storage destination");
    if (request.method === "DELETE") {
      if (this.failRemove) return new Response(null, { status: 503 });
      this.files.delete(id);
      return new Response(null, { status: 204 });
    }
    if (url.pathname.endsWith("/confirm")) {
      if (!file.bytes || file.bytes.length !== file.size) {
        this.files.delete(id);
        return Response.json({ error: "Uploaded file does not match the declared size; it was removed." }, { status: 422 });
      }
      file.status = "active";
      return Response.json({ ...file, id, bytes: undefined });
    }
    if (url.pathname.endsWith("/links")) {
      const body = await request.json();
      if (this.failLink) return new Response(null, { status: 503 });
      if (body.entityType === "return") file.returnId = Number(body.entityId);
      else file.link = Number(body.entityId);
      return new Response(null, { status: 204 });
    }
    if (request.method === "PATCH") {
      if (this.failPromote) return new Response(null, { status: 503 });
      file.retentionType = "permanent";
      return Response.json({ ...file, id, expiresAt: null });
    }
    if (file.status !== "active") return new Response(null, { status: 404 });
    return Response.json({ ...file, id, bytes: undefined, url: await this.viewUrl(id) });
  };

  /** A previously confirmed browser upload for action tests that focus on the subsequent record change. */
  readyEvidence(module: "Fulfilment" | "Returns", bytes: Uint8Array = PNG, staffId = "ana") {
    const id = `file-${this.next++}`;
    const filename = module === "Fulfilment" ? "delivery.png" : "refund.png";
    this.files.set(id, { filename, contentType: "image/png", size: bytes.length,
      visibility: "private", retentionType: "temporary", status: "active" });
    return sealUpload({ filename, contentType: "image/png", size: bytes.length, fileId: id,
      module, staffId, context: { ticketId: null }, phase: "ready", expires: Date.now() + 60_000 });
  }

  async view(id: string) {
    if (this.failUpload) throw new Error("storage unavailable");
    const file = this.files.get(id);
    if (!file) throw new Error("missing file");
    return { ...file, id, url: await this.viewUrl(id) };
  }

  async upload(file: { filename: string; contentType: ImageContentType; bytes: Uint8Array; retentionType?: "permanent" | "temporary" }) {
    if (this.failUpload) throw new Error("file-storage is down");

    const id = `file-${this.next++}`;
    this.files.set(id, { filename: file.filename, contentType: file.contentType, size: file.bytes.length, visibility: "private", retentionType: file.retentionType ?? "permanent", status: "active" });

    return id;
  }

  async promote(fileId: string) {
    if (this.failPromote) throw new Error("file-storage is down");
    this.files.get(fileId)!.retentionType = "permanent";
  }

  async linkRefundProof(fileId: string, returnId: number) {
    if (this.failLink) throw new Error("file-storage is down");
    this.files.get(fileId)!.returnId = returnId;
  }

  async linkToMessage(fileId: string, messageId: number) {
    if (this.failLink) throw new Error("file-storage is down");
    this.files.get(fileId)!.link = messageId;
  }

  async viewUrl(fileId: string) {
    if (!this.files.has(fileId)) throw new Error("File not found");

    return `https://files.test/${fileId}?signature=short-lived`;
  }

  async remove(fileId: string) {
    this.files.delete(fileId);
  }
}

export const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
export const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
export const PDF = new TextEncoder().encode("%PDF-1.7 not an image");
