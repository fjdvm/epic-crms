import { PaymentAccountForm } from "./payment-account-form";
import { PaymentAccountQr } from "./payment-account-qr";
import { PaymentAccountControls, PaymentMethodToggle } from "./payment-account-controls";
import { methodLabel, PAYMENT_METHODS } from "./payment-account-format";
import type { PaymentAccountRow } from "./payment-accounts";

export function PaymentAccountList({ accounts, failed, disabledMethods = [] }: { accounts: PaymentAccountRow[]; failed?: boolean; disabledMethods?: string[] }) {
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-[#1f1a2e]">Payment accounts</h2>
        {!failed && <PaymentAccountForm />}
      </div>
      {!failed && (
        <div className="flex flex-wrap items-center gap-2">
          {PAYMENT_METHODS.map((m) => <PaymentMethodToggle key={m.value} method={m.value} enabled={!disabledMethods.includes(m.value)} />)}
          {disabledMethods.length > 0 && <span className="text-xs text-[#6e6680]">Disabled: {disabledMethods.map(methodLabel).join(", ")}</span>}
        </div>
      )}
      {failed ? (
        <p role="status" className="text-sm text-[#8a5a00]">The Payment accounts could not be loaded. Reload the page.</p>
      ) : accounts.length === 0 ? (
        <p className="text-sm text-[#6e6680]">No Payment accounts yet.</p>
      ) : (
        <ul className="divide-y divide-[#f0f0f2] rounded-lg border border-[#e6e1ee]">
          {accounts.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 px-4 py-3 text-sm">
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 font-medium text-[#1f1a2e]">{a.label} <span className="text-xs font-normal text-[#6e6680]">{a.active ? "Active" : "Inactive"}</span></p>
                <p className="text-[#6e6680]">{methodLabel(a.method)}{a.bankName ? ` · ${a.bankName}` : ""} · {a.accountName} · {a.maskedNumber}</p>
              </div>
              <div className="flex items-center gap-4">
                <PaymentAccountQr accountId={a.id} label={a.label} hasQr={a.hasQr} />
                <PaymentAccountControls account={a} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
