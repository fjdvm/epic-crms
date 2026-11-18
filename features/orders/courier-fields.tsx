"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { COURIERS, LINK_MAX, RIDER_MAX, linkProblem, type CourierInput } from "./dispatch-record";

/** The form state of one courier booking, with what must be fixed before it can be sent. */
export function useCourierForm(initial: Partial<CourierInput> = {}) {
  const [courier, setCourier] = useState(initial.courier ?? "");
  const [trackingUrl, setTrackingUrl] = useState(initial.trackingUrl ?? "");
  const [riderName, setRiderName] = useState(initial.riderName ?? "");
  const [riderPhone, setRiderPhone] = useState(initial.riderPhone ?? "");
  const [riderPlate, setRiderPlate] = useState(initial.riderPlate ?? "");
  const linkError = linkProblem(trackingUrl);
  const input: CourierInput = { courier, trackingUrl, riderName, riderPlate, riderPhone };
  return { input, linkError, valid: COURIERS.some(name => name === courier) && !linkError,
    set: { courier: setCourier, trackingUrl: setTrackingUrl, riderName: setRiderName, riderPhone: setRiderPhone, riderPlate: setRiderPlate } };
}

/** Courier (required), booking share link and rider details (optional), as in the Figma dispatch dialog. */
export function CourierFields({ form, idPrefix = "" }: { form: ReturnType<typeof useCourierForm>; idPrefix?: string }) {
  const { input, linkError, set } = form;
  return (
    <>
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}courier`} className="text-[13px] font-medium text-foreground">Courier</Label>
        <div id={`${idPrefix}courier`} role="radiogroup" aria-label="Courier" className="flex gap-2">
          {COURIERS.map(name => (
            <button
              key={name}
              type="button"
              role="radio"
              aria-checked={input.courier === name}
              onClick={() => set.courier(name)}
              className={`h-9 flex-1 rounded-lg border text-[13px] ${input.courier === name ? "border-[#5b2a86] bg-[#f4effa] font-medium text-[#5b2a86]" : "border-[#e6e1ee]"}`}
            >
              {name}
            </button>
          ))}
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}tracking-link`} className="text-[13px] font-medium text-foreground">Booking share link (optional)</Label>
        <Input id={`${idPrefix}tracking-link`} type="url" autoComplete="off" placeholder="https://…" maxLength={LINK_MAX + 1} value={input.trackingUrl} onChange={e => set.trackingUrl(e.target.value)} aria-invalid={linkError ? true : undefined} />
        {linkError ? <p role="alert" className="text-xs text-[#dc2626]">{linkError}</p> : null}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}rider-name`} className="text-[13px] font-medium text-foreground">Rider name (optional)</Label>
        <Input id={`${idPrefix}rider-name`} autoComplete="off" maxLength={RIDER_MAX} value={input.riderName} onChange={e => set.riderName(e.target.value)} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}rider-contact`} className="text-[13px] font-medium text-foreground">Rider contact (optional)</Label>
          <Input id={`${idPrefix}rider-contact`} type="tel" autoComplete="off" maxLength={RIDER_MAX} value={input.riderPhone} onChange={e => set.riderPhone(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${idPrefix}rider-plate`} className="text-[13px] font-medium text-foreground">Plate no. (optional)</Label>
          <Input id={`${idPrefix}rider-plate`} autoComplete="off" maxLength={RIDER_MAX} value={input.riderPlate} onChange={e => set.riderPlate(e.target.value)} />
        </div>
      </div>
    </>
  );
}
