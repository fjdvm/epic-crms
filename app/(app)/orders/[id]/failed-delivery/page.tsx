import Link from "next/link";
import { notFound } from "next/navigation";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { approvals } from "@/features/approvals/server";
import { toView, WAITING } from "@/features/approvals/view";
import { BackgroundRefresh } from "@/features/orders/background-refresh";
import { toAttempts } from "@/features/orders/failed-delivery";
import { loadFailedDeliveryHistory } from "@/features/orders/failed-delivery-actions";
import { FailedDeliveryView } from "@/features/orders/failed-delivery-view";
import { loadOrder } from "@/features/orders/orders";
import { FULFILMENT_MODULE } from "@/lib/portal/config";
import { shopRole } from "@/lib/portal/roles";
import { requireModule } from "@/lib/portal/staff";
import { ticketsDatabase } from "@/lib/tickets-db";

export default async function FailedDeliveryPage({ params }: { params: Promise<{ id: string }> }) {
  const staff = await requireModule(FULFILMENT_MODULE);
  const { id } = await params;
  if (!/^\d{1,9}$/.test(id)) notFound();

  const [result, history] = await Promise.all([loadOrder(ticketsDatabase, Number(id)), loadFailedDeliveryHistory(Number(id))]);
  if (result.ok && !result.order) notFound();

  if (!result.ok || !result.order || !history.ok) {
    return (
      <div className="p-md sm:p-lg">
        <BackgroundRefresh />
        <Alert variant="destructive">
          <AlertTitle>Failed delivery is temporarily unavailable</AlertTitle>
          <AlertDescription>CREOMS could not read this Order. Reload to try again.</AlertDescription>
        </Alert>
      </div>
    );
  }

  const requests = (await approvals().list(staff, FULFILMENT_MODULE).catch(() => []))
    .map((row) => toView(row as unknown as Record<string, unknown>))
    .filter((r) => r.action === "write-off" && r.targetId === id);

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col gap-5 overflow-hidden px-8 py-7">
      <BackgroundRefresh />
      <div className="shrink-0 space-y-1">
        <Link href={`/orders/${id}`} className="text-sm text-[#5b2a86]">← Order #{id}</Link>
      </div>
      <FailedDeliveryView
        order={{ id: result.order.id, status: result.order.status, customerName: result.order.customer.name, paymentMethod: result.order.paymentMethod, total: result.order.total,
          lines: result.order.lines.map((l) => ({ product: l.product, quantity: l.quantity })) }}
        attempts={toAttempts(history.history as unknown as Record<string, unknown>[])}
        role={shopRole(staff.role)}
        writeOff={{ approvalId: requests.find((r) => r.status === "approved")?.id, waiting: requests.some((r) => WAITING.includes(r.status)) }}
      />
    </div>
  );
}
