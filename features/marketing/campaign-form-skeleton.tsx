import { ChevronLeft } from "lucide-react";
import Link from "next/link";

import { Skeleton } from "@/components/ui/skeleton";

/** Static chrome renders as-is; the fields are skeleton until the form loads. Pass `heading` when it is already known. */
export function CampaignFormSkeleton({ heading }: { heading?: string }) {
  return (
    <div role="status" aria-label="Loading campaign" className="flex h-[calc(100vh-4rem)] flex-col gap-4 overflow-hidden bg-[#fafafa] px-8 pt-5 pb-4">
      <div className="flex shrink-0 flex-col gap-1">
        <Link href="/email-campaigns" className="inline-flex items-center gap-1 text-[13px] font-medium leading-[normal] text-[#71717a]">
          <ChevronLeft className="size-4" aria-hidden /> Email Campaigns
        </Link>
        {heading ? (
          <h1 className="text-2xl font-semibold leading-[normal] text-[#18181b]">{heading}</h1>
        ) : (
          <Skeleton className="h-8 w-56" />
        )}
        <p className="text-sm leading-[normal] text-[#71717a]">
          Write it once and it goes to every Subscriber. Save it as a Draft to come back to it.
        </p>
      </div>

      <section className="flex min-h-0 flex-1 flex-col gap-[14px] overflow-hidden rounded-xl border border-[#e6e1ee] bg-white px-5 py-[18px]">
        <h2 className="text-[15px] font-semibold leading-[normal] text-[#18181b]">Content</h2>
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-24 w-full" />
      </section>
    </div>
  );
}
