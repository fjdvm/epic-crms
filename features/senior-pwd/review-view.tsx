"use client";

import { useEffect, useState } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { OrderActionDialog } from "@/features/orders/action-dialog";
import { formatDate } from "@/features/customer-profiles/format";
import type { ShopRole } from "@/lib/portal/roles";

import {
  approveVerification, declineVerification, loadVerificationPhoto, overrideVerification, revokeVerification,
} from "./actions";
import type { Verification, VerificationList } from "./verifications";

const KIND = { senior: "Senior Citizen", pwd: "PWD" } as const;
const STATUS = { pending: "Waiting for review", approved: "Verified", declined: "Declined", revoked: "Revoked", expired: "Expired" } as const;

/** The private photo, fetched only when Staff open the review. The number is read from the photo, never stored. */
function Photo({ id, name }: { id: number; name: string }) {
  const [state, setState] = useState<{ url: string } | { error: string } | null>(null);
  useEffect(() => {
    let live = true;
    loadVerificationPhoto(id).then(
      (r) => live && setState(r.ok ? { url: r.url } : { error: r.reason }),
      () => live && setState({ error: "The ID photo could not be opened." }),
    );
    return () => { live = false; };
  }, [id]);
  if (!state) return <div role="status" aria-label="Loading ID photo" className="h-48 animate-pulse rounded-lg bg-[#f1edf6]" />;
  if ("error" in state) return <p role="alert" className="rounded-lg bg-[#fef2f2] px-3 py-2.5 text-[13px] text-[#b91c1c]">{state.error}</p>;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={state.url} alt={`ID photo of ${name}`} className="max-h-72 w-full rounded-lg border border-[#e4ddee] object-contain" />;
}

function Facts({ v }: { v: Verification }) {
  return (
    <dl className="grid grid-cols-2 gap-3 text-sm text-[#1f1a2e]">
      <div><dt className="text-xs text-[#71717a]">Account name</dt><dd className="font-medium">{v.customerName}</dd></div>
      <div><dt className="text-xs text-[#71717a]">ID type</dt><dd>{KIND[v.idType]}</dd></div>
    </dl>
  );
}

const NUMBER_NOTE = "Check the name and the ID number on the photo against the account. The number is not stored.";

function ApproveDialog({ v, label = "Approve", override = false }: { v: Verification; label?: string; override?: boolean }) {
  const [expiresOn, setExpiresOn] = useState("");
  const [reason, setReason] = useState("");
  return (
    <OrderActionDialog
      trigger={label}
      title={`${override ? "Override and approve" : "Approve"} ${v.customerName}'s ${KIND[v.idType]} ID?`}
      description="The Customer is emailed and gets 5% off one item until the ID expires."
      confirm={label}
      busy="Approving…"
      disabled={!expiresOn || (override && !reason.trim())}
      run={() => (override ? overrideVerification(v.id, expiresOn, reason) : approveVerification(v.id, expiresOn))}
      successMessage={`${v.customerName} is verified.`}
    >
      <Facts v={v} />
      {!override && <Photo id={v.id} name={v.customerName} />}
      <p className="text-[13px] text-[#71717a]">{NUMBER_NOTE}</p>
      <div className="space-y-1.5">
        <Label htmlFor={`expiry-${v.id}`} className="text-[13px] font-medium text-foreground">ID expiry date</Label>
        <Input id={`expiry-${v.id}`} type="date" value={expiresOn} onChange={(e) => setExpiresOn(e.target.value)} />
      </div>
      {override && <ReasonField id={`override-${v.id}`} label="Reason for the override" value={reason} onChange={setReason} />}
    </OrderActionDialog>
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

function DeclineDialog({ v }: { v: Verification }) {
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
      <Photo id={v.id} name={v.customerName} />
      <ReasonField id={`decline-${v.id}`} label="Reason (the Customer sees this)" value={reason} onChange={setReason} />
    </OrderActionDialog>
  );
}

function RevokeDialog({ v }: { v: Verification }) {
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

const REQUEST = "Request approval";

function PendingActions({ v, role }: { v: Verification; role: ShopRole | null }) {
  if (role !== "staff" && role !== "manager") return <span className="text-xs text-[#71717a]">View only</span>;
  return <div className="flex gap-2"><ApproveDialog v={v} /><DeclineDialog v={v} /></div>;
}

function DecidedActions({ v, role }: { v: Verification; role: ShopRole | null }) {
  const managerAction = v.status === "declined" || v.status === "revoked" ? "override" : v.status === "approved" ? "revoke" : null;
  if (!managerAction || (role !== "staff" && role !== "manager")) return null;
  if (role === "staff") return <span className="text-xs font-medium text-[#5b2a86]">{REQUEST}</span>;
  return managerAction === "override" ? <ApproveDialog v={v} label="Override" override /> : <RevokeDialog v={v} />;
}

function Row({ v, role, decided }: { v: Verification; role: ShopRole | null; decided: boolean }) {
  return (
    <li className="flex items-center gap-4 border-b border-[#efebf4] py-3 text-sm text-[#1f1a2e]">
      <div className="min-w-0 flex-1">
        <p className="font-medium">{v.customerName}</p>
        <p className="text-xs text-[#6e6680]">
          {KIND[v.idType]} · sent {formatDate(v.submittedAt)}
          {!decided && ` · photo removed ${formatDate(v.photoExpiresAt)} if not reviewed`}
        </p>
      </div>
      {decided && (
        <div className="text-right text-xs text-[#6e6680]">
          <p className="text-sm font-medium text-[#1f1a2e]">{STATUS[v.status]}</p>
          <p>{v.decidedByName ? `${v.decidedByName} · ` : ""}{v.status === "declined" && v.declineReason ? v.declineReason : v.expiresOn ? `until ${v.expiresOn}` : ""}</p>
        </div>
      )}
      {decided ? <DecidedActions v={v} role={role} /> : <PendingActions v={v} role={role} />}
    </li>
  );
}

/** Staff review each ID before the Order confirms. Built from the foundation node: no Figma frame exists for this screen. */
export function VerificationsView({ list, role }: { list: VerificationList; role: ShopRole | null }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-auto">
      <section className="rounded-xl border border-[#e6e1ee] bg-white p-5">
        <h2 className="text-[15px] font-semibold text-[#18181b]">Waiting for review ({list.pending.length})</h2>
        {list.pending.length === 0
          ? <p className="pt-2 text-sm text-[#6e6680]">Nothing is waiting for review.</p>
          : <ul>{list.pending.map((v) => <Row key={v.id} v={v} role={role} decided={false} />)}</ul>}
      </section>
      <section className="rounded-xl border border-[#e6e1ee] bg-white p-5">
        <h2 className="text-[15px] font-semibold text-[#18181b]">Latest decisions</h2>
        {list.decided.length === 0
          ? <p className="pt-2 text-sm text-[#6e6680]">No decisions yet.</p>
          : <ul>{list.decided.map((v) => <Row key={v.id} v={v} role={role} decided />)}</ul>}
      </section>
    </div>
  );
}
