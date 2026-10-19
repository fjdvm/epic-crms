import { TableSkeleton } from "@/components/shared/table-skeleton";

export default function Loading() {
  return (
    <div className="p-md sm:p-lg">
      <TableSkeleton columns={8} />
    </div>
  );
}
