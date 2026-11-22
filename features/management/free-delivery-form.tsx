"use client";

import { useState } from "react";

import { NumericInput } from "@/components/ui/numeric-input";
import { Label } from "@/components/ui/label";
import { OrderActionDialog } from "@/features/orders/action-dialog";

import { setFreeDeliveryThreshold } from "./delivery-actions";
import { parseThreshold, pesos } from "./threshold-format";

/** The Free delivery threshold: validated here for quick feedback and again on the server. Never optimistic. */
export function FreeDeliveryForm({ currentInCentavos }: { currentInCentavos: number | null }) {
  const [value, setValue] = useState(currentInCentavos === null ? "" : String(currentInCentavos / 100));
  const parsed = parseThreshold(value);
  const error = value.trim() && !parsed.ok ? parsed.reason : null;
  const unchanged = parsed.ok && parsed.thresholdInCentavos === currentInCentavos;

  return (
    <section className="w-full max-w-[28rem] space-y-4">
      <div className="space-y-1">
        <h2 className="text-base font-semibold text-[#1f1a2e]">Free delivery threshold</h2>
        <p className="text-sm text-[#6e6680]">
          A Delivery Order whose subtotal after discounts is over this amount ships free. Orders already placed keep the rule they were placed under.
        </p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="free-delivery-threshold">Amount (₱)</Label>
        <NumericInput
          id="free-delivery-threshold"
          kind="peso"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "free-delivery-threshold-error" : undefined}
        />
        {error && <p id="free-delivery-threshold-error" role="alert" className="text-xs text-[#dc2626]">{error}</p>}
        {currentInCentavos !== null ? (
          <p className="text-xs text-[#6e6680]">Current: {pesos(currentInCentavos)}</p>
        ) : (
          <p role="status" className="text-xs text-[#8a5a00]">The current threshold could not be loaded. Reload before changing it.</p>
        )}
      </div>
      <OrderActionDialog
        trigger="Save threshold"
        title="Change the Free delivery threshold?"
        description={parsed.ok ? `Delivery Orders over ${pesos(parsed.thresholdInCentavos)} will ship free from now on.` : "Enter a valid amount first."}
        confirm="Save threshold"
        busy="Saving…"
        disabled={!parsed.ok || unchanged}
        run={() => setFreeDeliveryThreshold(value)}
        successMessage="Free delivery threshold saved."
      >
        {parsed.ok && (
          <p>
            From {currentInCentavos === null ? "an unknown amount" : pesos(currentInCentavos)} to <strong>{pesos(parsed.thresholdInCentavos)}</strong>. Orders already placed are not changed.
          </p>
        )}
      </OrderActionDialog>
    </section>
  );
}
