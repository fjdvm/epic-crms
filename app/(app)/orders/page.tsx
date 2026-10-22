import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { BackgroundRefresh } from "@/features/orders/background-refresh";
import { OrderListView } from "@/features/orders/order-list";
import { loadOrders, ORDER_TABS } from "@/features/orders/orders";
import { ticketsDatabase } from "@/lib/tickets-db";
import { ORDERS_MODULE } from "@/lib/portal/config";
import { requireModule } from "@/lib/portal/staff";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

export default async function OrdersPage({ searchParams }: { searchParams: SearchParams }) {
  await requireModule(ORDERS_MODULE);

  const raw = await searchParams;
  const tab = ORDER_TABS.find((t) => t === first(raw.tab)) ?? "all";
  const page = Math.max(1, Number.parseInt(first(raw.page), 10) || 1);

  const result = await loadOrders(ticketsDatabase, { tab, page });

  if (!result.ok) {
    return (
      <div className="p-md sm:p-lg space-y-md">
        <BackgroundRefresh />
        <h1 className="text-2xl font-semibold leading-[normal] text-foreground">Orders</h1>
        <Alert variant="destructive">
          <AlertTitle>Orders are temporarily unavailable</AlertTitle>
          <AlertDescription>
            CREOMS could not read the store&apos;s Orders. Reload to try again; if it keeps happening,
            tell whoever maintains CREOMS.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  const { list } = result;

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col gap-5 overflow-hidden px-8 py-7">
      <BackgroundRefresh />
      <div className="shrink-0 space-y-1">
        <h1 className="text-2xl font-semibold leading-[normal] text-[#1f1a2e]">Orders</h1>
        <p className="text-sm leading-[normal] text-[#6e6680]">
          {list.counts.all} Orders · placed on the store, shown here as the store has them
        </p>
      </div>
      <OrderListView list={list} params={{ tab, page: list.page }} />
    </div>
  );
}
