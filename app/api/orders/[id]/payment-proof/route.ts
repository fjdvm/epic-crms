import { ORDER_DETAIL_MODULES, CUSTOMER_PROFILES_MODULE, PAYMENTS_MODULE } from "@/lib/portal/config";
import { gatewayFileStorage } from "@/lib/gateway";
import { requireAnyModule } from "@/lib/portal/staff";
import { ticketsDatabase } from "@/lib/tickets-db";

const notFound = () => new Response("Not found", { status: 404 });

/**
 * Sends Staff to a short-lived address for an Order's payment-proof screenshot in file-storage.
 * Orders with only a legacy Blob pathname have no File, so this answers 404 for them.
 */
export async function GET(_request: Request, context: RouteContext<"/api/orders/[id]/payment-proof">) {
  await requireAnyModule([...new Set([...ORDER_DETAIL_MODULES, PAYMENTS_MODULE, CUSTOMER_PROFILES_MODULE])]);

  const orderId = Number((await context.params).id);
  if (!Number.isSafeInteger(orderId) || orderId < 1) return notFound();

  const [row] = await ticketsDatabase()<{ payment_proof_file_id: string | null }[]>`
    select payment_proof_file_id from public.orders where id = ${orderId}`;
  if (!row?.payment_proof_file_id) return notFound();

  try {
    const url = await gatewayFileStorage.viewUrl(row.payment_proof_file_id);

    return new Response(null, { status: 302, headers: { Location: url, "Cache-Control": "private, no-store" } });
  } catch (error) {
    console.error(`The payment proof of Order #${orderId} could not be reached`, error);

    return notFound();
  }
}
