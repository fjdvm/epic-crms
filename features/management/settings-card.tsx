import { cn } from "@/lib/utils";

/**
 * One Commerce setting as a card: title and description on top, the fields in the body, and a footer bar
 * with the current value on the left and the Save button on the right. Full height, so cards in a row keep their footers level.
 */
export function SettingsCard({
  title,
  description,
  action,
  footer,
  footerClassName,
  className,
  children,
}: {
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  footer?: React.ReactNode;
  footerClassName?: string;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <section aria-label={title} className={cn("flex h-full flex-col rounded-xl border border-[#e6e1ee] bg-white", className)}>
      <div className="flex items-start justify-between gap-4 px-5 pt-5">
        <div className="min-w-0 space-y-1">
          <h3 className="text-base font-semibold text-[#1f1a2e]">{title}</h3>
          {description && <p className="text-sm text-[#6e6680]">{description}</p>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      <div className="flex-1 space-y-4 p-5">{children}</div>
      {footer && (
        <div className={cn("flex min-h-14 items-center justify-between gap-4 rounded-b-xl border-t border-[#e6e1ee] bg-[#faf9fc] px-5 py-3", footerClassName)}>
          {footer}
        </div>
      )}
    </section>
  );
}

/** A small heading over a group of cards. */
export function SettingsGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-[#6e6680]">{title}</h2>
      {children}
    </div>
  );
}
