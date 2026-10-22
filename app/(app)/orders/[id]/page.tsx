import { notFound } from "next/navigation";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { BackgroundRefresh } from "@/features/orders/background-refresh";
import { OrderDetailView } from "@/features/orders/order-detail";
import { loadOrder } from "@/features/orders/orders";
import { ORDER_DETAIL_MODULES } from "@/lib/portal/config";
import { heldModules, requireAnyModule } from "@/lib/portal/staff";
import { ticketsDatabase } from "@/lib/tickets-db";

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAnyModule(ORDER_DETAIL_MODULES);

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

  return (
    <>
      <BackgroundRefresh />
      <OrderDetailView order={result.order} modules={modules} />
    </>
  );
}
