import Link from "next/link";

export const MANAGEMENT_TABS = [
  { href: "/management/payment-management", label: "Payment Management" },
  { href: "/management/delivery-management", label: "Delivery Management" },
] as const;

/** The shared frame of the Management pages: title, the two tabs, and an empty body until each tab is built. */
export function ManagementFrame({
  active,
  children,
}: {
  active: (typeof MANAGEMENT_TABS)[number]["href"];
  children?: React.ReactNode;
}) {
  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col gap-5 overflow-hidden px-8 py-7">
      <div className="shrink-0 space-y-1">
        <h1 className="text-2xl font-semibold leading-[normal] text-[#1f1a2e]">Management</h1>
        <p className="text-sm leading-[normal] text-[#6e6680]">
          Shop rules for payment accounts and delivery.
        </p>
      </div>
      <nav aria-label="Management tabs" className="flex shrink-0 gap-2">
        {MANAGEMENT_TABS.map((tab) => (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={tab.href === active ? "page" : undefined}
            className={`rounded-lg border px-3 py-1.5 text-sm ${
              tab.href === active
                ? "border-[#5b2a86] bg-[#f7f3fb] text-[#5b2a86]"
                : "border-[#e6e1ee] bg-white text-[#1f1a2e]"
            }`}
          >
            {tab.label}
          </Link>
        ))}
      </nav>
      <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-[#e6e1ee] bg-white p-5">
        {children}
      </div>
    </div>
  );
}
