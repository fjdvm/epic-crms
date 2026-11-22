import { Skeleton } from "@/components/ui/skeleton";
export default function Loading() {
  return (
    <div
      className="space-y-4 p-8"
      role="status"
      aria-label="Loading Order assistant"
    >
      <Skeleton className="h-8 w-72" />
      <Skeleton className="h-24" />
      <Skeleton className="h-80" />
    </div>
  );
}
