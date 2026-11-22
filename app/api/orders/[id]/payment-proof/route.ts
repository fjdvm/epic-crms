import { ORDER_DETAIL_MODULES, CUSTOMER_PROFILES_MODULE, PAYMENTS_MODULE } from "@/lib/portal/config";
import { gatewayFileStorage } from "@/lib/gateway";
import { requireAnyModule } from "@/lib/portal/staff";
import { ticketsDatabase } from "@/lib/tickets-db";

const notFound = () => new Response("Not found", { status: 404 });

/**
 * Sends Staff to a short-lived address for an Order's payment-proof screenshot in file-storage.
 * Orders with only a legacy Blob pathname have no File, so this answers 404 for them.
 */
export async function GET(request: Request, context: RouteContext<"/api/orders/[id]/payment-proof">) {
  await requireAnyModule([...new Set([...ORDER_DETAIL_MODULES, PAYMENTS_MODULE, CUSTOMER_PROFILES_MODULE])]);

  const orderId = Number((await context.params).id);
  if (!Number.isSafeInteger(orderId) || orderId < 1) return notFound();

  // `?proof=<id>` opens that one proof of this Order; without it, the Order's latest proof.
  const proofParam = new URL(request.url).searchParams.get("proof");
  let fileId: string | null | undefined;
  if (proofParam === null) {
    const [row] = await ticketsDatabase()<{ payment_proof_file_id: string | null }[]>`
      select payment_proof_file_id from public.orders where id = ${orderId}`;
    fileId = row?.payment_proof_file_id;
  } else {
    const proofId = Number(proofParam);
    if (!/^\d+$/.test(proofParam) || !Number.isSafeInteger(proofId) || proofId < 1) return notFound();
    const [row] = await ticketsDatabase()<{ screenshot_file_id: string | null }[]>`
      select screenshot_file_id from public.order_payment_proofs where id = ${proofId} and order_id = ${orderId}`;
    fileId = row?.screenshot_file_id;
  }
  if (!fileId) return notFound();

  try {
    const url = await gatewayFileStorage.viewUrl(fileId);

    return new Response(null, { status: 302, headers: { Location: url, "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error(`The payment proof of Order #${orderId} could not be reached`, error);

    return notFound();
  }
}
