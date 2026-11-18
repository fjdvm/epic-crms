import { viewStoredFile } from "@/features/files/server";
import { qrFileId } from "@/features/management/payment-accounts";
import { crmsDatabase } from "@/lib/crms-db";
import { MANAGEMENT_MODULE } from "@/lib/portal/config";
import { canManage } from "@/lib/portal/roles";
import { requireModule } from "@/lib/portal/staff";

const notFound = () => new Response("Not found", { status: 404 });

/**
 * Sends a Manager or the CEO to a short-lived signed address for an account's QR. The address is made on each
 * request and goes straight to the redirect: it is never stored, logged or audited.
 */
export async function GET(_request: Request, context: RouteContext<"/api/payment-accounts/[id]/qr">) {
  const staff = await requireModule(MANAGEMENT_MODULE);
  if (!canManage(staff)) return notFound();

  const { id } = await context.params;
  try {
    const fileId = await qrFileId(crmsDatabase(), id);
    if (!fileId) return notFound();
    const { url } = await viewStoredFile(MANAGEMENT_MODULE, fileId);
    return new Response(null, { status: 302, headers: { Location: url, "Cache-Control": "private, no-store" } });
  } catch {
    return notFound();
  }
}
