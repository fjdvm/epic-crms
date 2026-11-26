"use client";

import { useState } from "react";

import { NumericInput } from "@/components/ui/numeric-input";
import { Label } from "@/components/ui/label";
import { OrderActionDialog } from "@/features/orders/action-dialog";

import { setSeniorPwdDiscount } from "./senior-pwd-discount-actions";
import { DISCOUNT_PERIODS, describeDiscount, parseDiscount, type DiscountKind, type DiscountPer, type SeniorPwdDiscount } from "./senior-pwd-discount-format";
import { SettingsCard } from "./settings-card";

const SELECT = "h-9 w-full rounded-md border border-input bg-background px-3 text-sm";
const text = (hundredths: number) => String(hundredths / 100);

/** The Senior/PWD discount: a percentage or pesos, with a limit in pesos per day, week or month. Validated here and again on the server. Never optimistic. */
export function SeniorPwdDiscountForm({ current }: { current: SeniorPwdDiscount | null }) {
  const [kind, setKind] = useState<DiscountKind>(current?.kind ?? "percent");
  const [amount, setAmount] = useState(current ? text(current.hundredths) : "");
  const [limit, setLimit] = useState(current ? text(current.limitInCentavos) : "");
  const [per, setPer] = useState<DiscountPer>(current?.per ?? "week");
  const parsed = parseDiscount({ kind, amount, limit, per });
  const filled = amount.trim() !== "" && limit.trim() !== "";
  const error = filled && !parsed.ok ? parsed.reason : null;
  const unchanged = parsed.ok && current !== null && JSON.stringify(parsed.discount) === JSON.stringify(current);

  return (
    <SettingsCard
      title="Senior/PWD discount"
      description="What a verified Senior Citizen or PWD gets off one item, and the most they can get in a period. Orders already placed keep the rule they were placed under."
      footer={
        <>
          {current !== null ? (
            <p className="text-xs text-[#6e6680]">Current: {describeDiscount(current)}</p>
          ) : (
            <p role="status" className="text-xs text-[#8a5a00]">The current discount could not be loaded. Reload before changing it.</p>
          )}
          <OrderActionDialog
            trigger="Save discount"
            title="Change the Senior/PWD discount?"
            description={parsed.ok ? `Verified Customers will get ${describeDiscount(parsed.discount)} from now on.` : "Enter a valid discount and limit first."}
            confirm="Save discount"
            busy="Saving…"
            disabled={!parsed.ok || unchanged}
            run={() => setSeniorPwdDiscount({ kind, amount, limit, per })}
            successMessage="Senior/PWD discount saved."
          >
            {parsed.ok && (
              <p>
                From {current ? describeDiscount(current) : "an unknown rule"} to <strong>{describeDiscount(parsed.discount)}</strong>. Orders already placed are not changed.
              </p>
            )}
          </OrderActionDialog>
        </>
      }
    >
      <div className="grid grid-cols-[1fr_10rem] items-end gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="pwd-discount-amount">Discount</Label>
          <NumericInput id="pwd-discount-amount" kind="peso" value={amount} onChange={(e) => setAmount(e.target.value)} aria-invalid={error ? true : undefined} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pwd-discount-kind">Type</Label>
          <select id="pwd-discount-kind" className={SELECT} value={kind} onChange={(e) => setKind(e.target.value as DiscountKind)}>
            <option value="percent">Percentage (%)</option>
            <option value="pesos">Pesos (₱)</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pwd-discount-limit">Limit (₱)</Label>
          <NumericInput id="pwd-discount-limit" kind="peso" value={limit} onChange={(e) => setLimit(e.target.value)} aria-invalid={error ? true : undefined} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pwd-discount-per">Per</Label>
          <select id="pwd-discount-per" className={SELECT} value={per} onChange={(e) => setPer(e.target.value as DiscountPer)}>
            {DISCOUNT_PERIODS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>
      </div>
      {error && <p role="alert" className="text-xs text-[#dc2626]">{error}</p>}
    </SettingsCard>
  );
}
