/** How the Announcement looks in an inbox, as the Figma draws it. A text-only Announcement has no image area. */
export function InboxPreview({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex flex-col overflow-hidden rounded-[10px] border border-[#e4e4e7] bg-white" data-testid="inbox-preview">
      <div className="flex items-center gap-[10px] bg-[#18181b] px-[14px] py-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/images/bren-raphaels-logo.svg" alt="" className="size-7 shrink-0 rounded-[7px] bg-black" />
        <p className="text-sm font-semibold leading-[normal] text-white">Bren Raphael&apos;s</p>
      </div>
      <div className="flex flex-col gap-3 p-[18px]">
        <p className="text-lg font-bold leading-[normal] break-words text-[#18181b]">
          {title.trim() || <span className="text-[#a1a1aa]">Your title</span>}
        </p>
        <p className="text-[13px] leading-[normal] break-words whitespace-pre-wrap text-[#3f3f46]">
          {description.trim() || <span className="text-[#a1a1aa]">Your description</span>}
        </p>
      </div>
      <div className="bg-[#fafafa] px-[18px] pt-[10px] pb-3">
        <p className="text-[11px] leading-[normal] text-[#a1a1aa]">Antipolo, Rizal · Unsubscribe</p>
      </div>
    </div>
  );
}
