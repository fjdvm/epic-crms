import { cn } from "@/lib/utils";

import { PaymentAccountForm } from "./payment-account-form";
import { PaymentAccountCard } from "./payment-account-card";
import { PaymentMethodToggle } from "./payment-account-controls";
import { methodLabel, PAYMENT_METHODS } from "./payment-account-format";
import type { PaymentAccountRow } from "./payment-accounts";
import { SettingsCard } from "./settings-card";

export function PaymentAccountList({ accounts, failed, disabledMethods = [] }: { accounts: PaymentAccountRow[]; failed?: boolean; disabledMethods?: string[] }) {
  return (
    <SettingsCard
      title="Payment accounts"
      description="The accounts Customers pay into. Switch a whole method off to stop offering it; its accounts and history are kept."
      action={failed ? undefined : <PaymentAccountForm />}
    >
      {!failed && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-[#1f1a2e]">Methods offered to customers</h4>
          <ul className="grid grid-cols-3 gap-3">
            {PAYMENT_METHODS.map((m) => {
              const on = !disabledMethods.includes(m.value);
              return (
                <li key={m.value} className="flex items-center justify-between gap-3 rounded-lg border border-[#e6e1ee] px-4 py-2.5">
                  <span className="flex min-w-0 items-center gap-2 text-sm font-medium text-[#1f1a2e]">
                    <span className="truncate">{methodLabel(m.value)}</span>
                    <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", on ? "bg-[#e9dffa] text-[#4a2377]" : "bg-[#f0f0f2] text-[#6e6680]")}>{on ? "On" : "Off"}</span>
                  </span>
                  <PaymentMethodToggle method={m.value} enabled={on} />
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {failed ? (
        <p role="status" className="text-sm text-[#8a5a00]">The Payment accounts could not be loaded. Reload the page.</p>
      ) : (
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-[#1f1a2e]">Accounts</h4>
          {accounts.length === 0 ? (
            <p className="text-sm text-[#6e6680]">No Payment accounts yet.</p>
          ) : (
            <ul className="divide-y divide-[#f0f0f2] rounded-lg border border-[#e6e1ee]">
              {accounts.map((a) => <PaymentAccountCard key={a.id} account={a} />)}
            </ul>
          )}
        </div>
      )}
    </SettingsCard>
  );
}
