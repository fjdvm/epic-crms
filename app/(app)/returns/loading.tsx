import { ReturnsSkeleton } from "@/features/returns/returns-skeleton";
import { PageHeader } from "./page-header";

export default function Loading() {
  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col gap-5 overflow-hidden px-8 py-7">
      <PageHeader />
      <ReturnsSkeleton params={{ tab: "requested", page: 1 }} />
    </div>
  );
}
