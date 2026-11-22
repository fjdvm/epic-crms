import { currentAutomaticChecks } from "@/features/settings/automatic-checks-server";
import { notFound } from "next/navigation";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { BackgroundRefresh } from "@/features/orders/background-refresh";
import { OrderDetailView } from "@/features/orders/order-detail";
import { loadCodFlags } from "@/features/orders/cod-actions";
import { loadDispatchRecord } from "@/features/orders/dispatch-record-read";
import { loadOrder } from "@/features/orders/orders";
import { matchingPaymentAccounts } from "@/features/orders/payment-account-options";
import { loadCancellationState } from "@/features/orders/cancellation-state";
import { loadCancelRequest } from "@/features/orders/cancel-request-state";
import { proofReadsOrEmpty } from "@/features/orders/proof-read";
import { loadPaymentReview } from "@/features/orders/payment-review";
import { crmsDatabase } from "@/lib/crms-db";
import { currentPaymentReviewHours } from "@/features/settings/automatic-checks-server";
import { loadLineReservations } from "@/features/orders/stock";
import { loadEmbeddedReturns } from "@/features/returns/returns";
import { loadOrderReturnSummary } from "@/features/returns/outcome";
import { gatewayFileStorage } from "@/lib/gateway";
import { FULFILMENT_MODULE, ORDERS_MODULE, ORDER_DETAIL_MODULES, PAYMENTS_MODULE, RETURNS_MODULE } from "@/lib/portal/config";
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
    loadOrder(ticketsDatabase, Number(id), await currentAutomaticChecks()),
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

  // Only an Order with no Delivery fee yet is about to be confirmed, so only it needs the Payment accounts for the dropdown.
  const order = result.order.deliveryFee === null
    ? { ...result.order, paymentAccounts: await matchingPaymentAccounts(result.order.paymentMethod) }
    : result.order;
  let deliveryPhotoUrl: string | null | undefined;
  if (order.deliveryPhotoFileId) {
    try {
      deliveryPhotoUrl = await gatewayFileStorage.viewUrl(order.deliveryPhotoFileId);
    } catch (error) {
      console.error(`The Delivery photo of Order #${order.id} could not be reached`, error);
      deliveryPhotoUrl = null;
    }
  }

  // The Returns themselves belong to the Returns Module, so nobody else's page loads them.
  // How its Returns ended (and what a Replacement Order replaces) is part of the Order, so every viewer gets that summary.
  const [returns, reservations, returnSummary] = await Promise.all([
    modules.includes(RETURNS_MODULE) ? loadEmbeddedReturns(ticketsDatabase, { orderId: order.id }) : [],
    loadLineReservations(ticketsDatabase, order.id),
    loadOrderReturnSummary(ticketsDatabase, order.id),
  ]);

  const cancellation = order.status === "dispatched" && modules.includes(FULFILMENT_MODULE) ? await loadCancellationState(order.id) : null;
  const cancelRequest = ["placed", "confirmed", "awaiting payment"].includes(order.status) ? await loadCancelRequest(order.id) : null;
  const role = shopRole(staff.role);
  // Flags are for Staff and Managers who hold Orders; Admin and CEO see none, and a Customer never reaches this page.
  const codResult = modules.includes(ORDERS_MODULE) && (role === "staff" || role === "manager") ? await loadCodFlags(order.id) : null;
  // Rider details go only to Staff and Managers; Admin and CEO never receive them.
  const dispatch = order.fulfillmentMethod === "delivery" && ["dispatched", "delivered", "received"].includes(order.status)
    ? await loadDispatchRecord(ticketsDatabase(), order.id, role === "staff" || role === "manager").catch(() => null)
    : null;
  const codFlags = codResult?.ok ? codResult.flags[order.id] ?? [] : [];
  const requests = modules.includes(PAYMENTS_MODULE)
    ? (await approvals().list(staff, PAYMENTS_MODULE).catch(() => []))
        .map((row) => toView(row as unknown as Record<string, unknown>))
        .filter((r) => r.action === "payment.approve-anyway" && r.targetId === String(order.id))
    : [];
  const approvalId = requests.find((r) => r.status === "approved")?.id;
  const waitingApproval = requests.some((r) => WAITING.includes(r.status));

  // A review is read for anyone who can see Payments; a failure hides the panel rather than the Order.
  const paymentReview = modules.includes(PAYMENTS_MODULE) && order.status === "awaiting payment"
    ? await loadPaymentReview(ticketsDatabase(), crmsDatabase(), order.id, await currentPaymentReviewHours()).catch(() => null)
    : null;

  return (
    <>
      <BackgroundRefresh />
      <OrderDetailView
        paymentReview={paymentReview}
        proofReads={modules.includes(PAYMENTS_MODULE) ? await proofReadsOrEmpty(crmsDatabase(), order.paymentProofs.map(p => p.id)) : {}}
        role={role}
        approvalId={approvalId}
        waitingApproval={waitingApproval}
        cancellation={cancellation}
        cancelRequest={cancelRequest}
        order={order}
        dispatch={dispatch}
        codFlags={codFlags}
        modules={modules}
        deliveryPhotoUrl={deliveryPhotoUrl}
        returns={returns}
        returnSummary={returnSummary}
        reservations={reservations}
      />
    </>
  );
}
