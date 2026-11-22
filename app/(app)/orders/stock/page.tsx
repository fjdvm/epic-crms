import { Suspense } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { LiveStock } from "@/features/orders/stock-live";
import { readPublishedContent, stockMirror } from "@/features/orders/published-content";
import { loadStockCopy } from "@/features/orders/stock";
import { StockHeader, StockSkeleton } from "@/features/orders/stock-view";
import { ORDERS_MODULE } from "@/lib/portal/config";
import { canWork } from "@/lib/portal/roles";
import { requireModule } from "@/lib/portal/staff";
import { ticketsDatabase } from "@/lib/tickets-db";

/** The header and skeleton reach the browser at once; nothing here waits on the Portal or the IMS. */
export default function ProductsStockPage() {
  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col gap-4 overflow-hidden px-8 py-7">
      <StockHeader />
      <Suspense fallback={<StockSkeleton />}>
        <StockData />
      </Suspense>
    </div>
  );
}

async function StockData() {
  // Orders gates this page for Staff, Manager, and the read-only Admin and CEO alike; only Staff and Manager may edit a product.
  const staff = await requireModule(ORDERS_MODULE);
  const result = await loadStockCopy(ticketsDatabase, readPublishedContent, stockMirror);
  if (!result.ok) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Products &amp; stock is temporarily unavailable</AlertTitle>
        <AlertDescription>CREOMS could not read the store&apos;s Sizes. Reload to try again.</AlertDescription>
      </Alert>
    );
  }
  return <LiveStock page={result.page} canEdit={canWork(staff)} />;
}
