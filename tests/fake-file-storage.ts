import type { FileStorage, ImageContentType } from "@/features/tickets/attachments";

/** An in-memory file-storage: Private Files, short-lived addresses, and whatever failures a test asks for. */
export class FakeFileStorage implements FileStorage {
  files = new Map<string, { filename: string; contentType: string; size: number; link?: number; returnId?: number; visibility: "private"; retentionType: "permanent" | "temporary"; status: "active" }>();
  failUpload = false;
  failLink = false;
  failPromote = false;
  private next = 1;

  reset() {
    this.files.clear();
    this.failUpload = false;
    this.failLink = false;
    this.failPromote = false;
    this.next = 1;
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
