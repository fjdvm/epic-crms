"use client";

import { ChevronLeft } from "lucide-react";
import Link from "next/link";

import { formatDate } from "@/features/customer-profiles/format";

import { retrySendAction } from "./actions";
import { plural, type AnnouncementRow } from "./announcements";
import { StatusPill } from "./campaign-list";
import { InboxPreview } from "./inbox-preview";
import { RetrySend } from "./retry-send";

/** How a Sent or Failed Announcement went out. */
export function DeliveryNote({ announcement, className = "text-sm leading-[normal] text-[#71717a]" }: { announcement: AnnouncementRow; className?: string }) {
  return (
    <p className={className} data-testid="delivery">
      {announcement.state === "sent" &&
        `Sent to ${plural(announcement.sentTo ?? 0)}${announcement.sentAt ? ` on ${formatDate(announcement.sentAt)}` : ""}. It can no longer be changed.`}
      {announcement.state === "failed" &&
        `Not every Subscriber could be reached. ${announcement.sentTo ?? 0} ${announcement.sentTo === 1 ? "was" : "were"} emailed. Retry skips them, so nobody gets it twice.`}
    </p>
  );
}

/** An Announcement that is Sent or Failed: read-only, as it was sent, with Retry when it Failed. */
export function AnnouncementDetail({
  announcement,
  retry = retrySendAction,
}: {
  announcement: AnnouncementRow;
  retry?: typeof retrySendAction;
}) {
  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col gap-4 overflow-hidden bg-[#fafafa] px-8 pt-5 pb-4">
      <div className="flex shrink-0 items-start gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <Link href="/email-campaigns" className="inline-flex items-center gap-1 text-[13px] font-medium leading-[normal] text-[#71717a]">
            <ChevronLeft className="size-4" aria-hidden /> Email Campaigns
          </Link>
          <div className="flex items-center gap-3">
            <h1 className="min-w-0 truncate text-2xl font-semibold leading-[normal] text-[#18181b]">{announcement.title}</h1>
            <StatusPill state={announcement.state} />
          </div>
          <DeliveryNote announcement={announcement} />
        </div>
        {announcement.state === "failed" && <RetrySend announcement={announcement} retry={retry} />}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <section className="flex max-w-[420px] flex-col gap-[14px] rounded-xl border border-[#e6e1ee] bg-white px-5 py-[18px]">
          <h2 className="text-[15px] font-semibold leading-[normal] text-[#18181b]">What Subscribers received</h2>
          <InboxPreview title={announcement.title} description={announcement.description} images={announcement.images} imageLayout={announcement.imageLayout} />
        </section>
      </div>
    </div>
  );
}
