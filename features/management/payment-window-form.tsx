"use client";

import { useState } from "react";

import { NumericInput } from "@/components/ui/numeric-input";
import { Label } from "@/components/ui/label";
import { OrderActionDialog } from "@/features/orders/action-dialog";

import { parseWindowHours, hoursText } from "./payment-window-format";
import { changePaymentWindowHours } from "./settings-actions";

/** The payment window: how long a Customer has to pay after Staff confirm the Order. Validated here and on the server. Never optimistic. */
export function PaymentWindowForm({ currentHours }: { currentHours: number | null }) {
  const [value, setValue] = useState(currentHours === null ? "" : String(currentHours));
  const parsed = parseWindowHours(value);
  const error = value.trim() && !parsed.ok ? parsed.reason : null;
  const unchanged = parsed.ok && parsed.hours === currentHours;

  return (
    <section className="w-full max-w-[28rem] space-y-4">
      <div className="space-y-1">
        <h2 className="text-base font-semibold text-[#1f1a2e]">Payment window</h2>
        <p className="text-sm text-[#6e6680]">
          How long a Customer has to pay an Online-payment Order after Staff confirm it. Orders already confirmed keep the deadline they were given.
        </p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="payment-window-hours">Window (hours)</Label>
        <NumericInput
          id="payment-window-hours"
          kind="whole"
          value={value}
          disabled={currentHours === null}
          onChange={(e) => setValue(e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "payment-window-error" : undefined}
        />
        {error && <p id="payment-window-error" role="alert" className="text-xs text-[#dc2626]">{error}</p>}
        {currentHours !== null ? (
          <p className="text-xs text-[#6e6680]">Current: {hoursText(currentHours)}</p>
        ) : (
          <p role="status" className="text-xs text-[#8a5a00]">The current payment window could not be loaded. Reload before changing it.</p>
        )}
      </div>
      <OrderActionDialog
        trigger="Save payment window"
        title="Change the payment window?"
        description={parsed.ok ? `Orders confirmed from now on give the Customer ${hoursText(parsed.hours)} to pay.` : "Enter valid hours first."}
        confirm="Save payment window"
        busy="Saving…"
        disabled={!parsed.ok || unchanged}
        run={() => changePaymentWindowHours(value)}
        successMessage="Payment window saved."
      >
        {parsed.ok && (
          <p>
            From {currentHours === null ? "an unknown time" : hoursText(currentHours)} to <strong>{hoursText(parsed.hours)}</strong>. Orders already confirmed are not changed. The change is logged under your name.
          </p>
        )}
      </OrderActionDialog>
    </section>
  );
}
