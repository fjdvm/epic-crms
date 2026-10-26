import { FileText } from "lucide-react";

import type { TicketMessage } from "./ticket";

/**
 * A Message's image, video or PDF, from its short-lived signed address. The address expires, so
 * next/image's optimizer cannot cache it. An attachment whose address or type could not be read
 * still says one is there.
 */
export function MessageAttachment({ message, imageClassName }: { message: TicketMessage; imageClassName: string }) {
  const { attachmentUrl: url, attachmentType: type, attachmentName: name } = message;

  if (!url) {
    return message.hasAttachment ? (
      <p className="text-xs leading-[normal] font-medium text-[#5b2a86]">Photo attached</p>
    ) : null;
  }

  if (type?.startsWith("video/")) {
    return (
      <video
        src={url}
        controls
        preload="metadata"
        aria-label={`Video attached by ${message.senderName}`}
        className="max-h-64 max-w-full rounded-lg"
      />
    );
  }

  if (type === "application/pdf") {
    return (
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="flex items-center gap-2 rounded-lg border border-[#e6e1ee] bg-white px-3 py-2 text-sm leading-[normal] font-medium break-all text-[#5b2a86]"
      >
        <FileText aria-hidden className="size-4 shrink-0" />
        {name || "PDF"}
      </a>
    );
  }

  return (
    <a href={url} target="_blank" rel="noreferrer" className="block">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt={`Image attached by ${message.senderName}`} className={imageClassName} />
    </a>
  );
}
