"use client";

import { useState } from "react";

import { Input } from "@/components/ui/input";
import { NumericInput } from "@/components/ui/numeric-input";
import { Label } from "@/components/ui/label";
import { OrderActionDialog } from "@/features/orders/action-dialog";

import { removePaymentAccount, switchPaymentAccount, switchPaymentMethod, updatePaymentAccount } from "./payment-actions";
import { methodLabel, validateAccount, type PaymentMethod } from "./payment-account-format";
import type { PaymentAccountRow } from "./payment-accounts";

/** Edit, switch off or on, and delete one account. None of it is optimistic: it changes what Customers can choose. */
export function PaymentAccountControls({ account }: { account: PaymentAccountRow }) {
  const [form, setForm] = useState({ label: account.label, accountName: account.accountName, accountNumber: account.accountNumber, bankName: account.bankName ?? "" });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const valid = validateAccount({ ...form, method: account.method });
  const id = `pa-${account.id}`;

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <OrderActionDialog
        trigger="Edit"
        triggerClassName="bg-transparent !text-[#1f1a2e] border border-[#e6e1ee] hover:bg-[#f7f5fa]"
        title={`Edit ${account.label}?`}
        description="The method cannot change. The number is shown masked everywhere after this."
        confirm="Save changes"
        busy="Saving…"
        disabled={!valid.ok}
        run={() => updatePaymentAccount(account.id, { ...form, method: account.method as PaymentMethod })}
        successMessage="Payment account saved."
      >
        <div className="space-y-3">
          <div className="space-y-1"><Label htmlFor={`${id}-label`}>Label</Label><Input id={`${id}-label`} value={form.label} onChange={set("label")} /></div>
          <div className="space-y-1"><Label htmlFor={`${id}-name`}>Account name</Label><Input id={`${id}-name`} value={form.accountName} onChange={set("accountName")} /></div>
          {account.method === "bank_transfer" && <div className="space-y-1"><Label htmlFor={`${id}-bank`}>Bank name</Label><Input id={`${id}-bank`} value={form.bankName} onChange={set("bankName")} /></div>}
          <div className="space-y-1"><Label htmlFor={`${id}-number`}>Account number</Label><NumericInput id={`${id}-number`} kind="whole" value={form.accountNumber} onChange={set("accountNumber")} /></div>
          {!valid.ok && <p role="alert" className="text-xs text-[#dc2626]">{valid.reason}</p>}
        </div>
      </OrderActionDialog>
      <OrderActionDialog
        trigger={account.active ? "Switch off" : "Switch on"}
        triggerClassName="bg-transparent !text-[#1f1a2e] border border-[#e6e1ee] hover:bg-[#f7f5fa]"
        title={account.active ? `Switch off ${account.label}?` : `Switch on ${account.label}?`}
        description={account.active ? "Customers will no longer be offered it. Its history is kept." : "Customers can be offered it again."}
        confirm={account.active ? "Switch off" : "Switch on"}
        busy="Saving…"
        run={() => switchPaymentAccount(account.id, !account.active)}
        successMessage={account.active ? "Payment account switched off." : "Payment account switched on."}
      />
      {!account.used && (
        <OrderActionDialog
          trigger="Delete"
          tone="destructive"
          title={`Delete ${account.label}?`}
          description="It has never been used, so it can be removed. This cannot be undone."
          confirm="Delete account"
          busy="Deleting…"
          run={() => removePaymentAccount(account.id)}
          successMessage="Payment account deleted."
        />
      )}
    </div>
  );
}

/** Enables or disables a whole method; the page shows "Turn off" beside the method name, and screen readers hear "Turn off GCash". */
export function PaymentMethodToggle({ method, enabled }: { method: string; enabled: boolean }) {
  const label = methodLabel(method);
  return (
    <OrderActionDialog
      trigger={<>{enabled ? "Turn off" : "Turn on"}<span className="sr-only"> {label}</span></>}
      triggerClassName="bg-transparent !text-[#1f1a2e] border border-[#e6e1ee] hover:bg-[#f7f5fa] px-3 py-1.5 text-xs"
      title={enabled ? `Disable ${label}?` : `Enable ${label}?`}
      description={enabled ? `Customers will not be offered ${label} at all. The accounts and history are kept.` : `Customers can be offered ${label} again.`}
      confirm={enabled ? "Disable method" : "Enable method"}
      busy="Saving…"
      run={() => switchPaymentMethod(method, !enabled)}
      successMessage={enabled ? `${label} disabled.` : `${label} enabled.`}
    />
  );
}
