"use client";

import { useState } from "react";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

import { DeliveryNote } from "./announcement-detail";
import type { AnnouncementRow } from "./announcements";
import { StatusPill } from "./campaign-list";
import { InboxPreview } from "./inbox-preview";
import { RetrySend } from "./retry-send";

/** A Sent or Failed Announcement in the list: its title opens what Subscribers received in a modal, not another page. */
export function AnnouncementModalLink({ announcement }: { announcement: AnnouncementRow }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="truncate text-left font-medium text-[#5b2a86] hover:underline">
        {announcement.title}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-w-[480px] flex-col gap-4 sm:max-w-[480px] md:max-w-[480px] lg:max-w-[480px]">
          <div className="flex items-center gap-3 pr-6">
            <DialogTitle className="min-w-0 flex-1 truncate leading-[normal]">{announcement.title}</DialogTitle>
            <StatusPill state={announcement.state} />
          </div>
          <DialogDescription asChild>
            <DeliveryNote announcement={announcement} className="text-sm leading-[normal] text-[#71717a]" />
          </DialogDescription>
          <InboxPreview title={announcement.title} description={announcement.description} images={announcement.images} imageLayout={announcement.imageLayout} />
          {announcement.state === "failed" && (
            <div className="flex justify-end">
              <RetrySend announcement={announcement} />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
