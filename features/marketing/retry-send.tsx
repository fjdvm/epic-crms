"use client";

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

import { retrySendAction } from "./actions";
import { plural, SEND_REFUSALS, type AnnouncementRow } from "./announcements";

/** Retry for a Failed Announcement: the button, and the confirmation it asks for before sending. */
export function RetrySend({
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
    <>
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="shrink-0 rounded-lg bg-[#5b2a86] px-4 py-[9px] text-sm font-medium leading-[normal] text-white"
      >
        Retry
      </button>
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
    </>
  );
}
