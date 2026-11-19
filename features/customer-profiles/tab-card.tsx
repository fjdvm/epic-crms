export function TabCard({
  title,
  note,
  scroll = false,
  children,
}: {
  title: string;
  note?: string;
  /** Fills the height it is given and scrolls its content inside the card, instead of growing the page. */
  scroll?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={scroll ? "flex min-h-0 flex-col gap-[14px] overflow-hidden rounded-xl border border-border bg-card p-5" : "space-y-[14px] rounded-xl border border-border bg-card p-5"}>
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-foreground">{title}</h2>
        {note && <p className="text-[13px] font-medium text-primary">{note}</p>}
      </div>
      {scroll ? <div className="min-h-0 flex-1 space-y-5 overflow-y-auto">{children}</div> : children}
    </div>
  );
}
