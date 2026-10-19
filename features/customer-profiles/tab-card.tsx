export function TabCard({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-[14px] rounded-xl border border-border bg-card p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-foreground">{title}</h2>
        {note && <p className="text-[13px] font-medium text-primary">{note}</p>}
      </div>
      {children}
    </div>
  );
}
