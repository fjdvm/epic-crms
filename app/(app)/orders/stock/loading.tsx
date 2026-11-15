import { StockHeader, StockSkeleton } from "@/features/orders/stock-view";

export default function Loading() {
  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col gap-4 overflow-hidden px-8 py-7">
      <StockHeader />
      <StockSkeleton />
    </div>
  );
}
