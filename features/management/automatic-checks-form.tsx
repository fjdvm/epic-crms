"use client";

import { useState, type ReactNode } from "react";

import { Checkbox } from "@/components/ui/checkbox";
import { NumericInput } from "@/components/ui/numeric-input";
import type { AutomaticChecks } from "@/features/settings/automatic-checks";
import { OrderActionDialog } from "@/features/orders/action-dialog";

import { SettingsCard } from "./settings-card";
import { changeAutomaticChecks } from "./settings-actions";

import { centavosToPesos, pesosToCentavos, toWhole } from "./settings-format";

/** Numbers are kept as typed so a half-typed value does not jump; they are checked before saving. */
type Draft = { checks: AutomaticChecks; amount: string; text: Record<string, string> };

const LIMITS = { count: 1000, days: 3650, hours: 8760 } as const;

function draftOf(checks: AutomaticChecks): Draft {
  const { returns, dashboard } = checks;
  return {
    checks,
    amount: centavosToPesos(checks.cod.firstOrderOverAmount.amountInCentavos),
    text: {
      "returns.count": String(returns.frequentReturns.count), "returns.days": String(returns.frequentReturns.days),
      "unverified.count": String(dashboard.unverifiedPayments.count), "unverified.waitHours": String(dashboard.unverifiedPayments.waitHours),
      "spike.count": String(dashboard.returnSpike.count), "spike.days": String(dashboard.returnSpike.days),
      "failed.count": String(dashboard.unresolvedFailedDeliveries.count),
      "unconfirmed.hours": String(dashboard.unconfirmedOrders.hours), "reviews.hours": String(dashboard.paymentReviews.hours),
    },
  };
}

/** The set to save, or null while any number is not valid. */
export function buildChecks(draft: Draft): AutomaticChecks | null {
  const n = (key: string, max: number) => toWhole(draft.text[key], max);
  const amountInCentavos = pesosToCentavos(draft.amount);
  const rc = n("returns.count", LIMITS.count), rd = n("returns.days", LIMITS.days);
  const uc = n("unverified.count", LIMITS.count), uw = n("unverified.waitHours", LIMITS.hours);
  const sc = n("spike.count", LIMITS.count), sd = n("spike.days", LIMITS.days);
  const fc = n("failed.count", LIMITS.count), oh = n("unconfirmed.hours", LIMITS.hours), ph = n("reviews.hours", LIMITS.hours);
  if ([amountInCentavos, rc, rd, uc, uw, sc, sd, fc, oh, ph].some((value) => value === null)) return null;
  const { cod, returns, dashboard } = draft.checks;
  return {
    ...draft.checks,
    cod: { ...cod, firstOrderOverAmount: { ...cod.firstOrderOverAmount, amountInCentavos: amountInCentavos! } },
    returns: { ...returns, frequentReturns: { ...returns.frequentReturns, count: rc!, days: rd! } },
    dashboard: {
      unverifiedPayments: { ...dashboard.unverifiedPayments, count: uc!, waitHours: uw! },
      returnSpike: { ...dashboard.returnSpike, count: sc!, days: sd! },
      unresolvedFailedDeliveries: { ...dashboard.unresolvedFailedDeliveries, count: fc! },
      unconfirmedOrders: { ...dashboard.unconfirmedOrders, hours: oh! },
      paymentReviews: { ...dashboard.paymentReviews, hours: ph! },
    },
  };
}

const panel = "space-y-1 rounded-lg border border-[#e6e1ee] p-4";
const panelTitle = "pb-1 text-sm font-semibold text-[#1f1a2e]";
const inline = "flex flex-wrap items-center gap-1.5";

/**
 * Plain rules that only ever flag, never block. A Manager switches each rule and edits its numbers. The
 * Senior/PWD duplicate-ID check is always on and locked. Never optimistic: the new values show only once CREOMS accepts them.
 */
export function AutomaticChecksForm({ initial, overdueUrl = null }: { initial: AutomaticChecks | null; overdueUrl?: string | null }) {
  const [draft, setDraft] = useState<Draft | null>(initial ? draftOf(initial) : null);
  if (!draft || !initial) {
    return (
      <SettingsCard title="Automatic checks">
        <p className="text-sm text-[#dc2626]" role="alert">The Automatic checks could not be read from CREOMS. Reload to try again.</p>
      </SettingsCard>
    );
  }

  const next = buildChecks(draft);
  const changed = next !== null && JSON.stringify(next) !== JSON.stringify(initial);
  const { checks } = draft;
  const edit = (change: (current: AutomaticChecks) => AutomaticChecks) => setDraft({ ...draft, checks: change(checks) });
  const setText = (key: string, value: string) => setDraft({ ...draft, text: { ...draft.text, [key]: value } });

  /** A number box kept on one line with what follows it ("+", "days", "h"), so a unit never wraps away from its number. */
  const number = (key: string, label: string, after = "") => (
    <span className="inline-flex items-center gap-1 whitespace-nowrap">
      <NumericInput aria-label={label} className="inline-block h-7 w-12 px-1.5 text-center" kind="whole" value={draft.text[key]} onChange={(e) => setText(key, e.target.value)} />
      {after}
    </span>
  );
  const rule = (name: string, enabled: boolean, onChange: (on: boolean) => void, label: ReactNode) => (
    <div className="flex min-h-9 items-center gap-2.5 text-sm text-[#1f1a2e]" key={name}>
      <Checkbox aria-label={name} checked={enabled} onCheckedChange={(on) => onChange(on === true)} />
      <span className="min-w-0 flex-1">{label}</span>
    </div>
  );

  const { paymentProof: proof, cod, returns, dashboard: dash } = checks;
  const setProof = (key: keyof typeof proof) => (on: boolean) => edit((c) => ({ ...c, paymentProof: { ...c.paymentProof, [key]: { enabled: on } } }));

  return (
    <SettingsCard
      title="Automatic checks"
      description="Simple rules that run every time. They flag things for staff; they never cancel, reject or steer a customer on their own."
      footerClassName="sticky bottom-0 z-10"
      footer={
        <>
          {next === null ? (
            <p className="text-xs text-[#dc2626]" role="alert">Enter whole numbers: counts up to 1000, days up to 3650, hours up to 8760, pesos 0 or more.</p>
          ) : changed ? (
            <p className="text-xs font-medium text-[#4a2377]">Unsaved changes</p>
          ) : (
            <p className="text-xs text-[#6e6680]">No changes</p>
          )}
          <OrderActionDialog
            trigger="Save automatic checks"
            title="Change the Automatic checks?"
            description="The new switches and numbers apply from now on. They only flag; nothing is blocked or cancelled. The change is logged under your name."
            confirm="Save automatic checks"
            busy="Saving…"
            disabled={!changed}
            triggerDisabled={!changed}
            run={() => changeAutomaticChecks(next)}
            successMessage="Automatic checks saved."
          />
        </>
      }
    >
      <div className="grid grid-cols-2 gap-4">
        <div className={panel}>
          <h4 className={panelTitle}>GCash payment proof</h4>
          {rule("Reference already used", proof.reference.enabled, setProof("reference"), "Flag a reference number already used on another order")}
          {rule("Amount mismatch", proof.amount.enabled, setProof("amount"), "Flag when the amount doesn't match the order total")}
          {rule("Date before the order", proof.date.enabled, setProof("date"), "Flag when the date is before the order was placed")}
          {rule("Recipient mismatch", proof.recipient.enabled, setProof("recipient"), "Flag when the recipient isn't the shop's GCash number")}
        </div>
        <div className={panel}>
          <h4 className={panelTitle}>Cash on delivery flags</h4>
          <p className="pb-1 text-xs text-[#6e6680]">Shown to staff when confirming an order.</p>
          {rule("First order", cod.firstOrder.enabled, (on) => edit((c) => ({ ...c, cod: { ...c.cod, firstOrder: { enabled: on } } })), "First order")}
          {rule("First order over an amount", cod.firstOrderOverAmount.enabled,
            (on) => edit((c) => ({ ...c, cod: { ...c.cod, firstOrderOverAmount: { ...c.cod.firstOrderOverAmount, enabled: on } } })),
            <span className={inline}>First order over ₱
              <NumericInput aria-label="First order amount in pesos" className="inline-block h-7 w-20 px-1.5" kind="whole" value={draft.amount} onChange={(e) => setDraft({ ...draft, amount: e.target.value })} />
            </span>)}
          {rule("Past refused deliveries", cod.earlierRefusal.enabled, (on) => edit((c) => ({ ...c, cod: { ...c.cod, earlierRefusal: { enabled: on } } })), "Past refused deliveries")}
        </div>
        <div className={panel}>
          <h4 className={panelTitle}>Returns</h4>
          {rule("Frequent returns", returns.frequentReturns.enabled,
            (on) => edit((c) => ({ ...c, returns: { ...c.returns, frequentReturns: { ...c.returns.frequentReturns, enabled: on } } })),
            <span className={inline}>Flag a customer with {number("returns.count", "Returns to flag", "+")} returns in {number("returns.days", "Days for returns", "days")}</span>)}
          {rule("Photo already used", returns.reusedPhoto.enabled, (on) => edit((c) => ({ ...c, returns: { ...c.returns, reusedPhoto: { enabled: on } } })), "Flag a photo already used on another return (photo hash)")}
        </div>
        <div className={panel}>
          <h4 className={panelTitle}>Senior/PWD IDs</h4>
          <div className="flex min-h-9 items-center gap-2.5 text-sm text-[#6e6680]">
            <Checkbox aria-label="Duplicate Senior/PWD ID" checked disabled />
            <span className="min-w-0 flex-1">Block the same ID number on a second account (hash)</span>
            <span className="shrink-0 rounded-full bg-[#f0f0f2] px-2 py-0.5 text-xs font-medium">Always on</span>
          </div>
        </div>
        <div className={`${panel} col-span-2`}>
          <h4 className={panelTitle}>Dashboard alerts</h4>
          {rule("Unverified payments", dash.unverifiedPayments.enabled,
            (on) => edit((c) => ({ ...c, dashboard: { ...c.dashboard, unverifiedPayments: { ...c.dashboard.unverifiedPayments, enabled: on } } })),
            <span className={inline}>Unverified payments: {number("unverified.count", "Unverified payments to alert", "+")} or waiting over {number("unverified.waitHours", "Hours a proof may wait", "h")}</span>)}
          {rule("Returns on one product", dash.returnSpike.enabled,
            (on) => edit((c) => ({ ...c, dashboard: { ...c.dashboard, returnSpike: { ...c.dashboard.returnSpike, enabled: on } } })),
            <span className={inline}>Returns on one product: {number("spike.count", "Returns on one product", "+")} in {number("spike.days", "Days for returns on one product", "days")}</span>)}
          {rule("Unresolved failed deliveries", dash.unresolvedFailedDeliveries.enabled,
            (on) => edit((c) => ({ ...c, dashboard: { ...c.dashboard, unresolvedFailedDeliveries: { ...c.dashboard.unresolvedFailedDeliveries, enabled: on } } })),
            <span className={inline}>Unresolved failed deliveries: {number("failed.count", "Unresolved failed deliveries", "+")} unresolved</span>)}
          {rule("Orders not confirmed in time", dash.unconfirmedOrders.enabled,
            (on) => edit((c) => ({ ...c, dashboard: { ...c.dashboard, unconfirmedOrders: { ...c.dashboard.unconfirmedOrders, enabled: on } } })),
            <span className={inline}>Orders not confirmed within {number("unconfirmed.hours", "Hours to confirm an order", "h")}</span>)}
          {rule("Payment reviews not settled in time", dash.paymentReviews.enabled,
            (on) => edit((c) => ({ ...c, dashboard: { ...c.dashboard, paymentReviews: { ...c.dashboard.paymentReviews, enabled: on } } })),
            <span className={inline}>Manager payment reviews not settled within {number("reviews.hours", "Hours to settle a payment review", "h")}</span>)}
          <p className="flex min-h-9 items-center pl-6.5 text-sm text-[#6e6680]">
            Tickets breaching SLA: any{overdueUrl ? <> · <a className="ml-1 underline" href={overdueUrl}>View overdue tickets</a></> : null}
          </p>
        </div>
      </div>
    </SettingsCard>
  );
}
