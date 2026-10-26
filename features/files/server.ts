import { gatewayFileStorage } from "@/lib/gateway";
import { requireModule } from "@/lib/portal/staff";
import { TICKETS_MODULE } from "@/lib/portal/config";
import type { UploadModule } from "./policy";
import { openUpload } from "./reference";
import { directFileStorage, storageUrl } from "./storage";

/** Server-only record readers supply the owning Module and a File id obtained from that record. */
export async function viewStoredFile(module: UploadModule, fileId: string) {
  await requireModule(module);
  const file = await directFileStorage.view(fileId);
  if (file.id !== fileId || file.status !== "active") throw new Error("Attachment is unavailable");
  return { url: storageUrl(file.url), filename: file.filename, contentType: file.contentType, size: file.size };
}

/** A browser cannot turn a bare id, another Module's upload or another Staff member's upload into a Message attachment. */
export async function ticketUpload(reference: string, staffId: string, ticketId: number | null) {
  await requireModule(TICKETS_MODULE);
  const upload = openUpload(reference);
  if (!upload || upload.phase !== "ready" || upload.module !== TICKETS_MODULE || upload.staffId !== staffId || upload.context.ticketId !== ticketId) return null;
  const file = await directFileStorage.view(upload.fileId);
  if (file.id !== upload.fileId || file.status !== "active" || file.visibility !== "private" || file.retentionType !== "permanent" ||
    file.contentType !== upload.contentType || file.size !== upload.size) return null;
  return upload;
}

/** Ticket record loaders retain legacy operations while protecting each signed view. */
export const ticketFileStorage = {
  ...gatewayFileStorage,
  viewUrl: async (fileId: string) => (await viewStoredFile("Tickets", fileId)).url,
};
