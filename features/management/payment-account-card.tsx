"use client";

import { useState } from "react";
import { ChevronDown, CreditCard, Landmark, UserRound, Hash } from "lucide-react";

import { ZoomableImage } from "@/components/zoomable-image";
import { cn } from "@/lib/utils";

import { PaymentAccountControls } from "./payment-account-controls";
import { methodLabel } from "./payment-account-format";
import type { PaymentAccountRow } from "./payment-accounts";
import { PaymentAccountQr } from "./payment-account-qr";

/**
 * One Payment account as a collapsible card, laid out like the Order card:
 * collapsed it is a header with the status and a one-line summary; expanded it adds detail tiles and the actions.
 */
export function PaymentAccountCard({ account: a }: { account: PaymentAccountRow }) {
  const [open, setOpen] = useState(false);
  const panel = `pa-card-${a.id}`;
  const summary = `${methodLabel(a.method)}${a.bankName ? ` · ${a.bankName}` : ""} · ${a.accountName} · ${a.maskedNumber}`;
  const tiles = [
    { icon: CreditCard, label: "Method", value: methodLabel(a.method) },
    ...(a.bankName ? [{ icon: Landmark, label: "Bank", value: a.bankName }] : []),
    { icon: UserRound, label: "Account name", value: a.accountName },
    { icon: Hash, label: "Account number", value: a.maskedNumber },
  ];

  return (
    <li className="px-6 py-5 text-sm">
      <div className="flex items-start gap-4">
        {a.hasQr && (
          <ZoomableImage src={`/api/payment-accounts/${a.id}/qr`} alt={`QR for ${a.label}`} className="size-16 shrink-0 rounded-sm border border-[#e6e1ee] object-contain" />
        )}
        <div className="min-w-0 flex-1 space-y-1.5">
          <h3 className="truncate font-serif text-2xl text-[#4a2377]">{a.label}</h3>
          <span className={cn("inline-block rounded-full px-3 py-0.5 text-xs font-medium", a.active ? "bg-[#e9dffa] text-[#4a2377]" : "bg-[#f0f0f2] text-[#6e6680]")}>{a.active ? "Active" : "Inactive"}</span>
          <p className="truncate text-xs text-[#6e6680]">{summary}</p>
        </div>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panel}
          aria-label={`${open ? "Hide" : "Show"} details for ${a.label}`}
          onClick={() => setOpen((v) => !v)}
          className="flex size-10 shrink-0 items-center justify-center rounded-full border border-[#e6e1ee] text-[#1f1a2e] hover:bg-[#f7f5fa]"
        >
          <ChevronDown aria-hidden className={cn("size-4 transition-transform", open && "rotate-180")} />
        </button>
      </div>
      {open && (
        <div id={panel} className="mt-5 space-y-5">
          <dl className="grid gap-3 sm:grid-cols-3">
            {tiles.map(({ icon: Icon, label, value }) => (
              <div key={label} className="flex items-center gap-3 rounded-sm bg-[#f3f0f7] px-4 py-4">
                <Icon aria-hidden className="size-5 shrink-0 text-[#4a2377]" />
                <div className="min-w-0">
                  <dt className="text-xs text-[#6e6680]">{label}</dt>
                  <dd className="truncate font-medium text-[#1f1a2e]">{value}</dd>
                </div>
              </div>
            ))}
          </dl>
          <div className="flex flex-wrap items-start justify-between gap-4 border-t border-[#e6e1ee] pt-4">
            <PaymentAccountQr accountId={a.id} label={a.label} hasQr={a.hasQr} />
            <PaymentAccountControls account={a} />
          </div>
        </div>
      )}
    </li>
  );
}
