import { notFound } from "next/navigation";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { BackgroundRefresh } from "@/features/orders/background-refresh";
import { OrderDetailView } from "@/features/orders/order-detail";
import { loadOrder } from "@/features/orders/orders";
import { loadLineReservations } from "@/features/orders/stock";
import { loadEmbeddedReturns } from "@/features/returns/returns";
import { gatewayFileStorage } from "@/lib/gateway";
import { ORDER_DETAIL_MODULES, PAYMENTS_MODULE, RETURNS_MODULE } from "@/lib/portal/config";
import { approvals } from "@/features/approvals/server";
import { toView, WAITING } from "@/features/approvals/view";
import { shopRole } from "@/lib/portal/roles";
import { heldModules, requireAnyModule } from "@/lib/portal/staff";
import { ticketsDatabase } from "@/lib/tickets-db";

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const staff = await requireAnyModule(ORDER_DETAIL_MODULES);

  const { id } = await params;
  if (!/^\d{1,9}$/.test(id)) notFound();

  const [result, modules] = await Promise.all([
    loadOrder(ticketsDatabase, Number(id)),
    heldModules(ORDER_DETAIL_MODULES),
  ]);

  if (!result.ok) {
    return (
      <div className="p-md sm:p-lg">
        <BackgroundRefresh />
        <Alert variant="destructive">
          <AlertTitle>This Order is temporarily unavailable</AlertTitle>
          <AlertDescription>
            CREOMS could not read the store&apos;s Orders. Reload to try again; if it keeps happening, tell
            whoever maintains CREOMS.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  if (!result.order) notFound();

  const { order } = result;
  let deliveryPhotoUrl: string | null | undefined;
  if (order.deliveryPhotoFileId) {
    try {
      deliveryPhotoUrl = await gatewayFileStorage.viewUrl(order.deliveryPhotoFileId);
    } catch (error) {
      console.error(`The Delivery photo of Order #${order.id} could not be reached`, error);
      deliveryPhotoUrl = null;
    }
  }

  // Returns reads belong to the Returns Module, so nobody else's page even loads them.
  const [returns, reservations] = await Promise.all([
    modules.includes(RETURNS_MODULE) ? loadEmbeddedReturns(ticketsDatabase, { orderId: order.id }) : [],
    loadLineReservations(ticketsDatabase, order.id),
  ]);

  const role = shopRole(staff.role);
  const requests = modules.includes(PAYMENTS_MODULE)
    ? (await approvals().list(staff, PAYMENTS_MODULE).catch(() => []))
        .map((row) => toView(row as unknown as Record<string, unknown>))
        .filter((r) => r.action === "payment.approve-anyway" && r.targetId === String(order.id))
    : [];
  const approvalId = requests.find((r) => r.status === "approved")?.id;
  const waitingApproval = requests.some((r) => WAITING.includes(r.status));

  return (
    <>
      <BackgroundRefresh />
      <OrderDetailView
        role={role}
        approvalId={approvalId}
        waitingApproval={waitingApproval}
        order={order}
        modules={modules}
        deliveryPhotoUrl={deliveryPhotoUrl}
        returns={returns}
        reservations={reservations}
      />
    </>
  );
}
