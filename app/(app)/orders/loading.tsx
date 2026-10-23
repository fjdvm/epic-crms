import { OrdersSkeleton } from "@/features/orders/orders-skeleton";
import { PageHeader } from "./page-header";

export default function Loading() {
  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col gap-5 overflow-hidden px-8 py-7">
      <PageHeader />
      <OrdersSkeleton params={{ tab: "all", page: 1 }} />
    </div>
  );
}
