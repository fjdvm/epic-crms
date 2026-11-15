import { Suspense } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { BackgroundRefresh } from "@/features/orders/background-refresh";
import { OrderListView, type OrderListParams } from "@/features/orders/order-list";
import { OrdersSkeleton } from "@/features/orders/orders-skeleton";
import { loadOrders, ORDER_TABS } from "@/features/orders/orders";
import { ticketsDatabase } from "@/lib/tickets-db";
import { ORDERS_MODULE } from "@/lib/portal/config";
import { loadCodFlagsForOrders } from "@/features/orders/cod-actions";
import { shopRole } from "@/lib/portal/roles";
import { requireModule } from "@/lib/portal/staff";
import { PageHeader } from "./page-header";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

// Nothing here waits on the Portal or the database, so the header and skeleton reach the browser at once.
export default async function OrdersPage({ searchParams }: { searchParams: SearchParams }) {
  const raw = await searchParams;
  const tab = ORDER_TABS.find((t) => t === first(raw.tab)) ?? "all";
  const page = Math.max(1, Number.parseInt(first(raw.page), 10) || 1);

  const params = { tab, page };

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col gap-5 overflow-hidden px-8 py-7">
      <BackgroundRefresh />
      {/* Keyed so switching tab or page shows the skeleton at once instead of holding the old tab until the data lands. */}
      <Suspense
        key={`${tab}:${page}`}
        fallback={
          <>
            <PageHeader />
            <OrdersSkeleton params={params} />
          </>
        }
      >
        <OrdersData params={params} />
      </Suspense>
    </div>
  );
}

async function OrdersData({ params }: { params: OrderListParams }) {
  const staff = await requireModule(ORDERS_MODULE);

  const result = await loadOrders(ticketsDatabase, params);

  if (!result.ok) {
    return (
      <>
        <PageHeader />
        <Alert variant="destructive">
          <AlertTitle>Orders are temporarily unavailable</AlertTitle>
          <AlertDescription>
            CREOMS could not read the store&apos;s Orders. Reload to try again; if it keeps happening,
            tell whoever maintains CREOMS.
          </AlertDescription>
        </Alert>
      </>
    );
  }

  const { list } = result;
  // Flags are for Staff and Managers; Admin and CEO see none. A failure to work them out leaves the list as it was.
  const role = shopRole(staff.role);
  const flagged = role === "staff" || role === "manager" ? await loadCodFlagsForOrders(list.rows.map((r) => r.id)) : null;

  return (
    <>
      <PageHeader count={list.counts.all} />
      <OrderListView list={list} params={{ tab: params.tab, page: list.page }} codFlags={flagged?.ok ? flagged.flags : {}} />
    </>
  );
}
