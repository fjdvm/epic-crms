"use client";

import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/features/customer-profiles/format";

import { retrySendAction } from "./actions";
import { plural, SEND_REFUSALS, type AnnouncementRow } from "./announcements";
import { StatusPill } from "./campaign-list";
import { InboxPreview } from "./inbox-preview";


/** An Announcement that is Sent or Failed: read-only, as it was sent, with Retry when it Failed. */
export function AnnouncementDetail({
  announcement,
  retry = retrySendAction,
}: {
  announcement: AnnouncementRow;
  retry?: typeof retrySendAction;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const busy = useRef(false);

  const confirm = () => {
    if (busy.current) return;

    busy.current = true;
    startTransition(async () => {
      try {
        const result = await retry(announcement.id);

        setConfirming(false);
        if (!result.ok) {
          return void toast.error(result.reason === "unavailable" ? "CREOMS could not reach its database. Try again in a moment." : SEND_REFUSALS[result.reason]);
        }

        if (result.state === "sent") toast.success(`Sent to ${plural(result.subscribers)}.`);
        else toast.error("Some Subscribers still could not be reached. It is still Failed; retry again later.");

        router.refresh();
      } finally {
        busy.current = false;
      }
    });
  };

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
          <p className="text-sm leading-[normal] text-[#71717a]" data-testid="delivery">
            {announcement.state === "sent" &&
              `Sent to ${plural(announcement.sentTo ?? 0)}${announcement.sentAt ? ` on ${formatDate(announcement.sentAt)}` : ""}. It can no longer be changed.`}
            {announcement.state === "failed" &&
              `Not every Subscriber could be reached. ${announcement.sentTo ?? 0} ${announcement.sentTo === 1 ? "was" : "were"} emailed. Retry skips them, so nobody gets it twice.`}
          </p>
        </div>
        {announcement.state === "failed" && (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="shrink-0 rounded-lg bg-[#5b2a86] px-4 py-[9px] text-sm font-medium leading-[normal] text-white"
          >
            Retry
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <section className="flex max-w-[420px] flex-col gap-[14px] rounded-xl border border-[#e6e1ee] bg-white px-5 py-[18px]">
          <h2 className="text-[15px] font-semibold leading-[normal] text-[#18181b]">What Subscribers received</h2>
          <InboxPreview title={announcement.title} description={announcement.description} images={announcement.images} imageLayout={announcement.imageLayout} />
        </section>
      </div>

      <AlertDialog open={confirming} onOpenChange={(open) => !open && !pending && setConfirming(false)}>
        <AlertDialogContent
          onEscapeKeyDown={(event) => pending && event.preventDefault()}
          className="w-[calc(100%-2rem)] max-w-[24rem] sm:max-w-[24rem] md:max-w-[24rem] lg:max-w-[24rem] gap-4 p-6 sm:p-6 rounded-xl"
        >
          <AlertDialogHeader className="gap-2 text-left">
            <AlertDialogTitle className="text-lg font-semibold">Retry this send?</AlertDialogTitle>
            <AlertDialogDescription>
              It goes to every Subscriber it has not reached yet. Anyone who already received it is skipped.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-row justify-end gap-2 sm:space-x-0">
            <AlertDialogCancel disabled={pending} className="mt-0 sm:mt-0">
              Cancel
            </AlertDialogCancel>
            {/* A plain button, not AlertDialogAction: that would close the dialog and hide the loading state. */}
            <Button type="button" onClick={confirm} disabled={pending} className="bg-[#5b2a86] text-white hover:bg-[#5b2a86]/90">
              {pending ? "Working…" : "Retry"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
