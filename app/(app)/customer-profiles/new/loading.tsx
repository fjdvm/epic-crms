import { Skeleton } from "@/components/ui/skeleton";

/** The form is interactive and needs no data, so only the access check is waited on. */
export default function Loading() {
  return (
    <div role="status" aria-label="Loading form" className="space-y-4 px-xl py-7">
      <Skeleton className="h-9 w-40" />
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold leading-[normal] text-foreground">Add customer</h1>
        <p className="text-sm text-muted-foreground">
          For people who order by chat, phone or walk-in. Website shoppers get a profile automatically at checkout.
        </p>
      </div>
      <div className="space-y-4">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-10 w-full max-w-md" />
        ))}
      </div>
    </div>
  );
}
