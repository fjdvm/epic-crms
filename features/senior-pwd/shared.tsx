"use client";

import { Eye, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { OrderActionDialog } from "@/features/orders/action-dialog";
import { SENIOR_PWD_PAGE } from "@/lib/portal/pages";
import type { ShopRole } from "@/lib/portal/roles";

import { overrideVerification, revokeVerification, declineVerification } from "./actions";
import type { IdType, SameIdHolder, Verification, VerificationStatus } from "./verifications";

export const ID_KIND: Record<IdType, string> = { senior: "Senior citizen", pwd: "PWD" };
export const STATUS_LABEL: Record<VerificationStatus, string> = {
  pending: "Waiting for review", approved: "Verified", declined: "Declined", revoked: "Revoked", expired: "Expired",
};
export const STATUS_TONE: Record<VerificationStatus, string> = {
  pending: "bg-[#fef3c7] text-[#92400e]", approved: "bg-[#dcfce7] text-[#166534]", declined: "bg-[#fee2e2] text-[#991b1b]",
  revoked: "bg-[#fee2e2] text-[#991b1b]", expired: "bg-[#f4f4f5] text-[#52525b]",
};

const dateTime = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Manila" });
const dateTimeYear = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Manila" });
/** "17 Nov, 8:40 am" in Philippine Time. */
export const formatUploaded = (date: Date) => dateTime.format(date).replace(/ ([ap])m$/, (_, m) => ` ${m.toUpperCase()}M`);
/** "17 Nov 2026, 8:40 AM" in Philippine Time. */
export const formatUploadedFull = (date: Date) => dateTimeYear.format(date).replace(/ ([ap])m$/, (_, m) => ` ${m.toUpperCase()}M`);

/** How long the photo has left, in the Figma's words: "6 days 23 h", "5 h", or "under 1 h". */
export function formatRemaining(expiresAt: Date, now: Date): string {
  const hours = Math.floor((expiresAt.getTime() - now.getTime()) / 3_600_000);
  if (hours < 1) return "under 1 h";
  const days = Math.floor(hours / 24);
  const rest = hours % 24;
  if (days === 0) return `${hours} h`;
  return rest === 0 ? `${days} day${days === 1 ? "" : "s"}` : `${days} day${days === 1 ? "" : "s"} ${rest} h`;
}

/** Admin and CEO see everything and change nothing. */
export function ReadOnlyBadge() {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-[#f4f4f5] px-2.5 py-0.5 text-xs font-medium text-[#52525b]">
      <Eye aria-hidden className="size-3" /> Read-only
    </span>
  );
}

export function StatusPill({ status }: { status: VerificationStatus }) {
  return <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_TONE[status]}`}>{STATUS_LABEL[status]}</span>;
}

/**
 * The same ID number is on another account. Staff cannot see the number, but the storefront compared the hashes, so this
 * says who else used it and links to that check. Shown wherever the ID is reviewed or listed.
 */
export function SameIdWarning({ holder, compact = false }: { holder: SameIdHolder; compact?: boolean }) {
  const who = `${holder.customerName} (${holder.customerEmailHint}) · ${STATUS_LABEL[holder.status]}`;
  if (compact) {
    return (
      <p className="inline-flex items-center gap-1 pt-0.5 text-xs font-medium text-[#b45309]">
        <TriangleAlert aria-hidden className="size-3" /> ID already used by another account
      </p>
    );
  }
  return (
    <div role="alert" className="flex gap-2 rounded-xl border border-[#f5d38b] bg-[#fef9e7] px-4 py-3 text-[13px] text-[#92400e]">
      <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
      <p>
        <span className="font-semibold">This ID number is already used by another account.</span><br />
        {who}.{" "}
        <Link href={`${SENIOR_PWD_PAGE}/${holder.verificationId}`} className="font-medium underline">Open their check</Link>.
        {" "}Compare the name and photo before you approve, and decline it if it is not the Customer&apos;s own ID.
      </p>
    </div>
  );
}

function ReasonField({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (t: string) => void }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-[13px] font-medium text-foreground">{label}</Label>
      <Textarea id={id} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

/** Staff decline a waiting ID with a reason the Customer is told. Never optimistic: the Customer is emailed. */
export function DeclineDialog({ v }: { v: Verification }) {
  const [reason, setReason] = useState("");
  return (
    <OrderActionDialog
      trigger="Decline"
      triggerClassName="bg-background text-foreground border border-input hover:bg-accent"
      title={`Decline ${v.customerName}'s ID?`}
      description="The Customer is emailed your reason and the photo is deleted."
      confirm="Decline"
      busy="Declining…"
      tone="destructive"
      disabled={!reason.trim()}
      run={() => declineVerification(v.id, reason)}
      successMessage={`${v.customerName}'s ID was declined.`}
    >
      <ReasonField id={`decline-${v.id}`} label="Reason (the Customer sees this)" value={reason} onChange={setReason} />
    </OrderActionDialog>
  );
}

/** A Manager takes back an approved verification. The discount stops at once. */
export function RevokeDialog({ v }: { v: Verification }) {
  const [reason, setReason] = useState("");
  return (
    <OrderActionDialog
      trigger="Revoke"
      tone="destructive"
      title={`Revoke ${v.customerName}'s verification?`}
      description="The discount stops at once and the Customer is told."
      confirm="Revoke"
      busy="Revoking…"
      disabled={!reason.trim()}
      run={() => revokeVerification(v.id, reason)}
      successMessage={`${v.customerName}'s verification was revoked.`}
    >
      <ReasonField id={`revoke-${v.id}`} label="Reason" value={reason} onChange={setReason} />
    </OrderActionDialog>
  );
}

/** A Manager approves an ID Staff declined or that was revoked. The photo is gone, so the expiry is typed by hand. */
export function OverrideDialog({ v }: { v: Verification }) {
  const [expiresOn, setExpiresOn] = useState("");
  const [reason, setReason] = useState("");
  return (
    <OrderActionDialog
      trigger="Override"
      title={`Override and approve ${v.customerName}'s ${ID_KIND[v.idType]} ID?`}
      description="The Customer is emailed and gets the Senior/PWD discount on one item until the ID expires."
      confirm="Override"
      busy="Approving…"
      disabled={!expiresOn || !reason.trim()}
      run={() => overrideVerification(v.id, expiresOn, reason)}
      successMessage={`${v.customerName} is verified.`}
    >
      <p className="text-[13px] text-[#71717a]">Check the name and the ID number on the original ID. The number is not stored.</p>
      <div className="space-y-1.5">
        <Label htmlFor={`expiry-${v.id}`} className="text-[13px] font-medium text-foreground">ID expiry date</Label>
        <Input id={`expiry-${v.id}`} type="date" value={expiresOn} onChange={(e) => setExpiresOn(e.target.value)} />
      </div>
      <ReasonField id={`override-${v.id}`} label="Reason for the override" value={reason} onChange={setReason} />
    </OrderActionDialog>
  );
}

/** What each Role may do with an ID that is already decided. Staff ask a Manager; Admin and CEO only look. */
export function DecidedActions({ v, role }: { v: Verification; role: ShopRole | null }) {
  const managerAction = v.status === "declined" || v.status === "revoked" ? "override" : v.status === "approved" ? "revoke" : null;
  if (!managerAction || (role !== "staff" && role !== "manager")) return null;
  if (role === "staff") return <span className="text-xs font-medium text-[#5b2a86]">Request approval</span>;
  return managerAction === "override" ? <OverrideDialog v={v} /> : <RevokeDialog v={v} />;
}
