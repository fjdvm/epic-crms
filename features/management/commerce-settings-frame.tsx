/** The frame of the one Management screen: title and a scrolling body, no tabs. */
export function CommerceSettingsFrame({ children }: { children?: React.ReactNode }) {
  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col gap-5 overflow-hidden px-8 py-7">
      <div className="shrink-0 space-y-1">
        <h1 className="text-2xl font-semibold leading-[normal] text-[#1f1a2e]">Commerce Settings</h1>
        <p className="text-sm leading-[normal] text-[#6e6680]">
          Shop rules for payment accounts, delivery, approvals, service levels and automatic checks.
        </p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-[#e6e1ee] bg-white p-5">
        {children}
      </div>
    </div>
  );
}
