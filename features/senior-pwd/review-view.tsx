"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { OrderActionDialog } from "@/features/orders/action-dialog";
import { formatDate } from "@/features/customer-profiles/format";
import type { ShopRole } from "@/lib/portal/roles";

import {
  approveVerification, declineVerification, loadVerificationPhoto, overrideVerification, revokeVerification,
} from "./actions";
import { nameMatches, parseIdText, type IdFields } from "./id-reading";
import { readIdPhoto } from "./read-id-photo";
import type { Verification, VerificationList } from "./verifications";

const KIND = { senior: "Senior Citizen", pwd: "PWD" } as const;
const STATUS = { pending: "Waiting for review", approved: "Verified", declined: "Declined", revoked: "Revoked", expired: "Expired" } as const;

/** The private photo, fetched only when Staff open the review. The number is read from the photo, never stored. */
function Photo({ id, name, onLoaded }: { id: number; name: string; onLoaded?: (url: string) => void }) {
  const [state, setState] = useState<{ url: string; backUrl: string | null } | { error: string } | null>(null);
  useEffect(() => {
    let live = true;
    loadVerificationPhoto(id).then(
      (r) => { if (!live) return; setState(r.ok ? { url: r.url, backUrl: r.backUrl ?? null } : { error: r.reason }); if (r.ok) onLoaded?.(r.url); },
      () => live && setState({ error: "The ID photo could not be opened." }),
    );
    return () => { live = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  if (!state) return <div role="status" aria-label="Loading ID photo" className="h-48 animate-pulse rounded-lg bg-[#f1edf6]" />;
  if ("error" in state) return <p role="alert" className="rounded-lg bg-[#fef2f2] px-3 py-2.5 text-[13px] text-[#b91c1c]">{state.error}</p>;
  // eslint-disable-next-line @next/next/no-img-element
  return (
    <div className="space-y-2">
      <img src={state.url} alt={`ID photo of ${name}`} className="max-h-72 w-full rounded-lg border border-[#e4ddee] object-contain" />
      {state.backUrl && <img src={state.backUrl} alt={`Back of the ID of ${name}`} className="max-h-72 w-full rounded-lg border border-[#e4ddee] object-contain" />}
    </div>
  );
}

function Facts({ v }: { v: Verification }) {
  return (
    <dl className="grid grid-cols-2 gap-3 text-sm text-[#1f1a2e]">
      <div><dt className="text-xs text-[#71717a]">Account name</dt><dd className="font-medium">{v.customerName}</dd></div>
      <div><dt className="text-xs text-[#71717a]">ID type</dt><dd>{KIND[v.idType]}</dd></div>
    </dl>
  );
}


type Field = "name" | "idNumber" | "expiresOn";
const FIELD_LABEL: Record<Field, string> = { name: "Name", idNumber: "ID number", expiresOn: "Expiry" };

/**
 * "Read from the photo": the browser reads the ID and pre-fills each field. Nothing is applied until Staff confirm it, they
 * can type over any field, and a failed reading leaves every field empty for typing. Nothing read is stored or sent.
 */
function PhotoReading({ v, onConfirmed }: { v: Verification; onConfirmed: (expiresOn: string, ready: boolean) => void }) {
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [reading, setReading] = useState<"idle" | "reading" | "failed" | "done">("idle");
  const [values, setValues] = useState<Record<Field, string>>({ name: "", idNumber: "", expiresOn: "" });
  const [confirmed, setConfirmed] = useState<Record<Field, boolean>>({ name: false, idNumber: false, expiresOn: false });
  const started = useRef(false);

  useEffect(() => {
    if (!photoUrl || started.current) return;
    started.current = true;
    setReading("reading");
    let live = true;
    readIdPhoto(photoUrl).then(
      (text) => {
        if (!live) return;
        const f: IdFields = parseIdText(text);
        setValues({ name: f.name ?? "", idNumber: f.idNumber ?? "", expiresOn: f.expiresOn ?? "" });
        setReading("done");
      },
      () => live && setReading("failed"),
    );
    return () => { live = false; };
  }, [photoUrl]);

  const change = (field: Field, value: string) => {
    setValues((c) => ({ ...c, [field]: value }));
    setConfirmed((c) => ({ ...c, [field]: false }));
  };
  const confirm = (field: Field) => setConfirmed((c) => ({ ...c, [field]: true }));
  const mismatch = confirmed.name && !nameMatches(values.name, v.customerName);
  const ready = confirmed.name && confirmed.idNumber && confirmed.expiresOn && !mismatch;
  useEffect(() => { onConfirmed(confirmed.expiresOn ? values.expiresOn : "", ready); }, [confirmed, values.expiresOn, ready, onConfirmed]);

  const hint = (field: Field) => {
    if (field === "name" && values.name) return nameMatches(values.name, v.customerName) ? `Matches the account name "${v.customerName}"` : `Does not match the account name "${v.customerName}"`;
    if (field === "idNumber") return "Checked against other accounts by the storefront; never stored here";
    return "Type the date shown on the ID";
  };

  return (
    <section aria-label="Read from the photo" className="space-y-3 rounded-lg border border-[#e4ddee] p-3">
      <Photo id={v.id} name={v.customerName} onLoaded={setPhotoUrl} />
      <div className="flex items-center justify-between">
        <h3 className="text-[13px] font-semibold text-[#18181b]">Read from the photo · please confirm each</h3>
        <span className="rounded-full bg-[#f1edf6] px-2 py-0.5 text-[11px] text-[#5b2a86]">OCR in your browser</span>
      </div>
      {reading === "reading" && <p role="status" className="text-[13px] text-[#71717a]">Reading the photo…</p>}
      {reading === "failed" && <p role="status" className="text-[13px] text-[#b45309]">The photo could not be read. Type each field from the photo.</p>}
      {(["name", "idNumber", "expiresOn"] as const).map((field) => (
        <div key={field} className="space-y-1">
          <Label htmlFor={`read-${field}-${v.id}`} className="text-xs text-[#71717a]">{FIELD_LABEL[field]}</Label>
          <div className="flex items-center gap-2">
            <Input
              id={`read-${field}-${v.id}`}
              type={field === "expiresOn" ? "date" : "text"}
              value={values[field]}
              onChange={(e) => change(field, e.target.value)}
            />
            <button
              type="button"
              disabled={!values[field].trim() || confirmed[field]}
              aria-label={`Confirm ${FIELD_LABEL[field].toLowerCase()}`}
              onClick={() => confirm(field)}
              className="shrink-0 rounded-lg border border-input px-3 py-1.5 text-[13px] font-medium disabled:opacity-60"
            >
              {confirmed[field] ? "Confirmed" : "Confirm"}
            </button>
          </div>
          <p className={`text-xs ${field === "name" && values.name && !nameMatches(values.name, v.customerName) ? "text-[#b91c1c]" : "text-[#71717a]"}`}>{hint(field)}</p>
        </div>
      ))}
      {mismatch && <p role="alert" className="text-[13px] text-[#b91c1c]">The name on the ID does not match the account. Decline it, or correct the name.</p>}
      <p className="text-xs text-[#71717a]">The reading only fills in fields. It does not judge if the ID is genuine: you do. The image never leaves your browser.</p>
    </section>
  );
}

const NUMBER_NOTE = "Check the name and the ID number on the photo against the account. The number is not stored.";

function ApproveDialog({ v, label = "Approve", override = false }: { v: Verification; label?: string; override?: boolean }) {
  const [expiresOn, setExpiresOn] = useState("");
  const [ready, setReady] = useState(false);
  const [reason, setReason] = useState("");
  const onConfirmed = useCallback((date: string, ok: boolean) => { setExpiresOn(date); setReady(ok); }, []);
  return (
    <OrderActionDialog
      trigger={label}
      title={`${override ? "Override and approve" : "Approve"} ${v.customerName}'s ${KIND[v.idType]} ID?`}
      description="The Customer is emailed and gets 5% off one item until the ID expires."
      confirm={label}
      busy="Approving…"
      disabled={override ? !expiresOn || !reason.trim() : !ready || !expiresOn}
      run={() => (override ? overrideVerification(v.id, expiresOn, reason) : approveVerification(v.id, expiresOn))}
      successMessage={`${v.customerName} is verified.`}
    >
      <Facts v={v} />
      {!override && <PhotoReading v={v} onConfirmed={onConfirmed} />}
      {override && (
        <>
          <p className="text-[13px] text-[#71717a]">{NUMBER_NOTE}</p>
          <div className="space-y-1.5">
            <Label htmlFor={`expiry-${v.id}`} className="text-[13px] font-medium text-foreground">ID expiry date</Label>
            <Input id={`expiry-${v.id}`} type="date" value={expiresOn} onChange={(e) => setExpiresOn(e.target.value)} />
          </div>
          <ReasonField id={`override-${v.id}`} label="Reason for the override" value={reason} onChange={setReason} />
        </>
      )}
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
