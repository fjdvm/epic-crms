"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NumericInput } from "@/components/ui/numeric-input";
import { Label } from "@/components/ui/label";
import { OrderActionDialog } from "@/features/orders/action-dialog";

import { createPaymentAccount } from "./payment-actions";
import { maskNumber, methodLabel, PAYMENT_METHODS, validateAccount, type PaymentMethod } from "./payment-account-format";

const empty = { method: "gcash" as PaymentMethod, label: "", accountName: "", accountNumber: "", bankName: "" };

/**
 * The "Add payment account" button and the modal with the fields. Validated here for quick feedback and again on the
 * server; the confirm dialog still comes first, and saving is never optimistic.
 */
export function PaymentAccountForm() {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(empty);
  const set = (k: keyof typeof empty) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const valid = validateAccount(form);
  const touched = Boolean(form.label || form.accountName || form.accountNumber || form.bankName);
  const error = touched && !valid.ok ? valid.reason : null;
  const isBank = form.method === "bank_transfer";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" className="h-auto rounded-lg px-4 py-[9px] leading-[normal] shadow-none">Add payment account</Button>
      </DialogTrigger>
      <DialogContent className="max-w-[28rem] space-y-4 sm:max-w-[28rem] md:max-w-[28rem] lg:max-w-[28rem]">
      <DialogHeader>
        <DialogTitle className="text-base font-semibold text-[#1f1a2e]">Add a Payment account</DialogTitle>
        <DialogDescription className="text-[13px] text-[#6e6680]">The number is shown masked everywhere after you save.</DialogDescription>
      </DialogHeader>
      <div className="space-y-1.5">
        <Label htmlFor="pa-method">Method</Label>
        <select id="pa-method" value={form.method} onChange={set("method")} className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm">
          {PAYMENT_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
      </div>
      <div className="space-y-1.5"><Label htmlFor="pa-label">Label</Label><Input id="pa-label" value={form.label} onChange={set("label")} /></div>
      <div className="space-y-1.5"><Label htmlFor="pa-name">Account name</Label><Input id="pa-name" value={form.accountName} onChange={set("accountName")} /></div>
      {isBank && <div className="space-y-1.5"><Label htmlFor="pa-bank">Bank name</Label><Input id="pa-bank" value={form.bankName} onChange={set("bankName")} /></div>}
      <div className="space-y-1.5">
        <Label htmlFor="pa-number">Account number</Label>
        <NumericInput id="pa-number" kind="whole" value={form.accountNumber} onChange={set("accountNumber")} aria-invalid={error ? true : undefined} aria-describedby={error ? "pa-error" : undefined} />
        {error && <p id="pa-error" role="alert" className="text-xs text-[#dc2626]">{error}</p>}
      </div>
      <OrderActionDialog
        trigger="Add account"
        title="Add this Payment account?"
        description="Check the details. The number is shown masked everywhere after this."
        confirm="Add account"
        busy="Saving…"
        disabled={!valid.ok}
        run={async () => {
          const result = await createPaymentAccount(form);
          if (result.ok) { setForm(empty); setOpen(false); }
          return result;
        }}
        successMessage="Payment account added."
      >
        {valid.ok && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
            <dt className="text-[#6e6680]">Method</dt><dd>{methodLabel(valid.account.method)}</dd>
            <dt className="text-[#6e6680]">Name</dt><dd>{valid.account.accountName}</dd>
            {valid.account.bankName && (<><dt className="text-[#6e6680]">Bank</dt><dd>{valid.account.bankName}</dd></>)}
            <dt className="text-[#6e6680]">Number</dt><dd>{maskNumber(valid.account.numberNormalised)}</dd>
          </dl>
        )}
      </OrderActionDialog>
      </DialogContent>
    </Dialog>
  );
}
