"use client";

import { BackButton } from "@/components/shared/back-button";

import { Check, IdCard, Lock, ScanSearch, Sparkles, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { ImageViewer } from "@/components/image-viewer";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { OrderActionDialog } from "@/features/orders/action-dialog";
import { APPROVALS_ID_CHECKS } from "@/lib/portal/pages";
import type { ShopRole } from "@/lib/portal/roles";

import { approveVerification, loadVerificationPhoto } from "./actions";
import { ID_FLAG_TEXT, type IdReadState } from "./id-read-types";
import { nameMatches, parseIdText } from "./id-reading";
import { readIdPhoto } from "./read-id-photo";
import { DecidedActions, DeclineDialog, ID_KIND, ReadOnlyBadge, STATUS_LABEL, SameIdWarning, StatusPill, formatUploadedFull } from "./shared";
import type { Verification } from "./verifications";

type Photos = { url: string; backUrl: string | null };

/** The private photo with zoom and rotate controls. Fetched only while the ID is waiting; deleted right after review. */
function PhotoCard({ v, photos }: { v: Verification; photos: Photos | { error: string } | null }) {
  const [viewing, setViewing] = useState<number | null>(null);
  const frame = "flex min-h-72 items-center justify-center overflow-auto rounded-lg bg-[#ece8f2]";
  const sides = photos && "url" in photos
    ? [
        { id: 0, url: photos.url, name: null, caption: `ID photo of ${v.customerName}` },
        ...(photos.backUrl ? [{ id: 1, url: photos.backUrl, name: null, caption: `Back of the ID of ${v.customerName}` }] : []),
      ]
    : [];
  const picture = (side: number) => (
    <button type="button" aria-label={`Zoom ${sides[side].caption}`} onClick={() => setViewing(side)} className="cursor-zoom-in">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={sides[side].url} alt={sides[side].caption} className="max-h-96 w-full object-contain" />
    </button>
  );
  return (
    <section aria-label="ID photo" className="min-w-0 space-y-3 rounded-xl border border-[#e6e1ee] bg-white p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-[15px] font-semibold text-[#18181b]">ID photo</h2>
        <span className="inline-flex items-center gap-1 rounded-full bg-[#f4f4f5] px-2 py-0.5 text-[11px] text-[#52525b]">
          <Lock aria-hidden className="size-3" /> Deleted after review
        </span>
      </div>
      {photos === null && <div role="status" aria-label="Loading ID photo" className="h-72 animate-pulse rounded-lg bg-[#f1edf6]" />}
      {photos && "error" in photos && (
        <div className={frame}>
          <p role="alert" className="max-w-xs px-4 py-8 text-center text-[13px] text-[#6e6680]">{photos.error}</p>
        </div>
      )}
      {photos && "url" in photos && (
        <div className="space-y-3">
          <div className={frame}>{picture(0)}</div>
          {sides[1] && <div className={frame}>{picture(1)}</div>}
          {viewing !== null && <ImageViewer images={sides} start={viewing} onClose={() => setViewing(null)} />}
        </div>
      )}
      <p className="text-xs text-[#6e6680]">
        {photos && "url" in photos
          ? "Click the photo to zoom and rotate. Ask the customer for a clearer photo from the ticket if needed."
          : v.status === "pending" ? "" : `The photo was deleted. The Customer uploads a new one if needed.`}
      </p>
    </section>
  );
}

function Hint({ children, tone = "muted" }: { children: React.ReactNode; tone?: "muted" | "good" | "bad" }) {
  const color = tone === "good" ? "text-[#15803d]" : tone === "bad" ? "text-[#b91c1c]" : "text-[#71717a]";
  return <p className={`text-xs ${color}`}>{children}</p>;
}

/**
 * "Read from the photo": the browser reads the ID and pre-fills the name and expiry. Nothing is applied until Staff
 * confirm each field; they can type over any of them, and a failed reading leaves them empty. The image never leaves
 * the browser, and the ID number is never read into a field: Staff read it off the photo, and it is not stored.
 */
function CheckFields({ v, photos, readOnly, canDecide }: { v: Verification; photos: Photos | { error: string } | null; readOnly: boolean; canDecide: boolean }) {
  const [reading, setReading] = useState<"idle" | "reading" | "failed" | "done">("idle");
  const [name, setName] = useState("");
  const [expiresOn, setExpiresOn] = useState("");
  const [confirmed, setConfirmed] = useState({ name: false, expiresOn: false });
  const started = useRef(false);
  const photoUrl = photos && "url" in photos ? photos.url : null;

  useEffect(() => {
    if (!photoUrl || started.current) return;
    started.current = true;
    setReading("reading");
    let live = true;
    readIdPhoto(photoUrl).then(
      (text) => {
        if (!live) return;
        const f = parseIdText(text);
        setName(f.name ?? "");
        setExpiresOn(f.expiresOn ?? "");
        setReading("done");
      },
      () => live && setReading("failed"),
    );
    return () => { live = false; };
  }, [photoUrl]);

  const matches = name.trim() !== "" && nameMatches(name, v.customerName);
  const mismatch = confirmed.name && !matches;
  const ready = confirmed.name && confirmed.expiresOn && matches && expiresOn !== "";
  const field = (done: boolean) => (done ? "border-[#86d19b] bg-[#f0fbf3]" : "");

  return (
    <div className="space-y-4">
      <div className="space-y-1 rounded-lg bg-[#f4effb] p-3">
        <div className="flex items-center justify-between">
          <p className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-[#5b2a86]"><Sparkles aria-hidden className="size-3.5" /> Read from the photo</p>
          <span className="rounded-full bg-[#e7dcf6] px-2 py-0.5 text-[11px] font-medium text-[#5b2a86]">Pre-filled</span>
        </div>
        <p className="text-xs text-[#6e6680]">We filled these in from the ID. Confirm each one against the photo before approving.</p>
        {reading === "reading" && <p role="status" className="text-xs text-[#71717a]">Reading the photo…</p>}
        {reading === "failed" && <p role="status" className="text-xs text-[#b45309]">The photo could not be read. Type each field from the photo.</p>}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="check-name" className="text-[13px] font-medium">Full name</Label>
        <div className="flex items-center gap-2">
          <Input id="check-name" value={name} disabled={readOnly} className={field(confirmed.name && matches)}
            onChange={(e) => { setName(e.target.value); setConfirmed((c) => ({ ...c, name: false })); }} />
          <ConfirmButton label="Confirm name" done={confirmed.name} disabled={readOnly || !name.trim()} onClick={() => setConfirmed((c) => ({ ...c, name: true }))} />
        </div>
        {name && (matches
          ? <Hint tone="good">Matches the account name</Hint>
          : <Hint tone="bad">{`Does not match the account name "${v.customerName}"`}</Hint>)}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="check-type" className="text-[13px] font-medium">ID type</Label>
        <Input id="check-type" readOnly value={ID_KIND[v.idType]} />
        <Hint>As the Customer chose it on the storefront</Hint>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="check-expiry" className="text-[13px] font-medium">Valid until</Label>
        <div className="flex items-center gap-2">
          <Input id="check-expiry" type="date" value={expiresOn} disabled={readOnly} className={field(confirmed.expiresOn)}
            onChange={(e) => { setExpiresOn(e.target.value); setConfirmed((c) => ({ ...c, expiresOn: false })); }} />
          <ConfirmButton label="Confirm expiry" done={confirmed.expiresOn} disabled={readOnly || !expiresOn} onClick={() => setConfirmed((c) => ({ ...c, expiresOn: true }))} />
        </div>
        <Hint>Needed to approve</Hint>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="check-number" className="text-[13px] font-medium">ID number</Label>
        <div className="relative">
          <Lock aria-hidden className="absolute left-2.5 top-2.5 size-4 text-[#a1a1aa]" />
          <Input id="check-number" disabled value="" placeholder="Shown only on the photo · not stored" className="pl-8" />
        </div>
      </div>

      {mismatch && <p role="alert" className="text-[13px] text-[#b91c1c]">The name on the ID does not match the account. Decline it, or correct the name.</p>}
      <p className="text-xs text-[#71717a]">The reading only fills in fields. It does not judge if the ID is genuine: you do. The image never leaves your browser.</p>

      {!readOnly && !canDecide && (
        <p className="pt-1 text-[13px] font-medium text-[#5b2a86]">Request approval · a Manager approves or declines this ID.</p>
      )}
      {!readOnly && canDecide && (
        <div className="flex gap-2 pt-1">
          <OrderActionDialog
            trigger="Approve"
            title={`Approve ${v.customerName}'s ${ID_KIND[v.idType]} ID?`}
            description="The Customer is emailed and gets the Senior/PWD discount on one item until the ID expires."
            confirm="Approve"
            busy="Approving…"
            triggerDisabled={!ready}
            run={() => approveVerification(v.id, expiresOn)}
            successMessage={`${v.customerName} is verified.`}
          />
          <DeclineDialog v={v} />
        </div>
      )}
    </div>
  );
}

/**
 * The ID reader's findings: what it read off the photo in the background and what it flagged. They are hints for the
 * person checking, never a decision; the ID number is never read or shown.
 */
export function IdReadFindings({ idRead, v }: { idRead: IdReadState; v: Verification }) {
  const box = "space-y-2 rounded-xl border p-4 text-[13px]";
  if (idRead === null || idRead.status === "reading") {
    return (
      <section aria-label="ID reader" className={`${box} border-[#e6e1ee] bg-white`}>
        <p className="inline-flex items-center gap-1.5 font-semibold text-[#5b2a86]"><ScanSearch aria-hidden className="size-4" /> ID reader</p>
        <p role="status" className="text-[#6e6680]">
          {idRead === null && v.status !== "pending"
            ? "This ID was not read before it was decided."
            : "Reading the photo… The findings appear here when it finishes. You can check the ID meanwhile."}
        </p>
      </section>
    );
  }
  const { findings, flags } = idRead;
  const flagged = flags.length > 0;
  return (
    <section aria-label="ID reader" className={`${box} ${flagged ? "border-[#f5d38b] bg-[#fef9e7]" : "border-[#bfe5ca] bg-[#f0fbf3]"}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="inline-flex items-center gap-1.5 font-semibold text-[#1f1a2e]"><ScanSearch aria-hidden className="size-4" /> ID reader</p>
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${flagged ? "bg-[#fde68a] text-[#92400e]" : "bg-[#dcfce7] text-[#166534]"}`}>
          {idRead.status === "needs-review" ? "Needs review" : flagged ? `${flags.length} to check` : "Nothing flagged"}
        </span>
      </div>
      {flagged && (
        <ul className="space-y-1 text-[#92400e]">
          {flags.map((flag) => (
            <li key={flag} className="flex gap-1.5"><TriangleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />{ID_FLAG_TEXT[flag]}</li>
          ))}
        </ul>
      )}
      {findings.editNote && <p className="text-[#92400e]">Reader&apos;s note: {findings.editNote}</p>}
      {idRead.status === "read" && (
        <dl className="grid grid-cols-[7rem_1fr] gap-y-1 text-[#3f3a4d]">
          <dt className="text-[#71717a]">Name read</dt><dd>{findings.name ?? "—"}</dd>
          <dt className="text-[#71717a]">Valid until</dt><dd>{findings.expiresOn ?? "—"}</dd>
          <dt className="text-[#71717a]">Looks like</dt>
          <dd>{findings.idKind === "senior" || findings.idKind === "pwd" ? `${ID_KIND[findings.idKind]} ID` : findings.idKind === "other" ? "Another kind of card" : "—"}</dd>
        </dl>
      )}
      <p className="text-xs text-[#71717a]">The reader only points things out. It does not approve or decline; a Manager decides.</p>
    </section>
  );
}

function ConfirmButton({ label, done, disabled, onClick }: { label: string; done: boolean; disabled: boolean; onClick: () => void }) {
  return (
    <button type="button" aria-label={label} disabled={disabled || done} onClick={onClick}
      className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-input px-3 py-1.5 text-[13px] font-medium disabled:opacity-60">
      {done && <Check aria-hidden className="size-3.5 text-[#15803d]" />}
      {done ? "Confirmed" : "Confirm"}
    </button>
  );
}

function Decision({ v, role }: { v: Verification; role: ShopRole | null }) {
  const rows: [string, string][] = [
    ["Decision", STATUS_LABEL[v.status]],
    ["Decided by", v.decidedByName ?? "—"],
    ...(v.verifiedName ? [["Verified as", v.verifiedName] as [string, string]] : []),
    ["Decided on", v.decidedAt ? formatUploadedFull(v.decidedAt) : "—"],
    ...(v.status === "declined" && v.declineReason ? [["Reason", v.declineReason] as [string, string]] : []),
    ...(v.expiresOn ? [["ID valid until", v.expiresOn] as [string, string]] : []),
  ];
  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-[8rem_1fr] gap-y-2 text-sm">
        {rows.map(([k, val]) => (<div key={k} className="contents"><dt className="text-[#71717a]">{k}</dt><dd className="text-[#1f1a2e]">{val}</dd></div>))}
      </dl>
      <p className="text-xs text-[#71717a]">The ID photo and number are not kept after review.</p>
      <DecidedActions v={v} role={role} />
    </div>
  );
}

/** One ID: the private photo beside the fields Staff check. Built from the Figma "Review ID" frame. */
export function SeniorPwdCheckDetail({ verification: v, idRead = null, readOnly, role }: {
  verification: Verification; idRead?: IdReadState; now: string; readOnly: boolean; role: ShopRole | null;
}) {
  const [photos, setPhotos] = useState<Photos | { error: string } | null>(v.status === "pending" ? null : { error: "The ID photo was deleted." });
  const waiting = v.status === "pending";

  const load = useCallback(() => {
    let live = true;
    loadVerificationPhoto(v.id).then(
      (r) => live && setPhotos(r.ok ? { url: r.url, backUrl: r.backUrl } : { error: r.reason }),
      () => live && setPhotos({ error: "The ID photo could not be opened." }),
    );
    return () => { live = false; };
  }, [v.id]);
  useEffect(() => (waiting ? load() : undefined), [waiting, load]);

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col gap-4 overflow-auto px-8 py-7">
      <div className="shrink-0 self-start"><BackButton fallbackHref={APPROVALS_ID_CHECKS} label="Approvals" /></div>
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold leading-[normal] text-[#1f1a2e]">Review ID · {v.customerName}</h1>
          <StatusPill status={v.status} />
          {readOnly && <ReadOnlyBadge />}
        </div>
        <p className="text-sm text-[#6e6680]">
          Uploaded {formatUploadedFull(v.submittedAt)}
          {v.orderId !== null && waiting && ` · holds order BR-${v.orderId}`}
        </p>
      </div>
      {v.sameIdAs && <SameIdWarning holder={v.sameIdAs} />}
      <IdReadFindings idRead={idRead} v={v} />
      <div className="grid items-start gap-5 md:grid-cols-[1.35fr_1fr]">
        {/* The photo is not shown at all once the ID is decided: it has been deleted. */}
        {waiting ? <PhotoCard v={v} photos={photos} /> : (
          <section aria-label="ID photo" className="flex min-h-72 flex-col items-center justify-center gap-2 rounded-xl border border-[#e6e1ee] bg-white p-5 text-center">
            <IdCard aria-hidden className="size-8 text-[#a1a1aa]" />
            <p className="text-sm text-[#6e6680]">The ID photo was deleted. Only the decision is kept.</p>
          </section>
        )}
        <section aria-label="Check each field" className="min-w-0 space-y-4 rounded-xl border border-[#e6e1ee] bg-white p-5">
          <h2 className="text-[15px] font-semibold text-[#18181b]">{waiting ? "Check each field" : "Decision"}</h2>
          {waiting ? <CheckFields v={v} photos={photos} readOnly={readOnly} canDecide={role === "manager"} /> : <Decision v={v} role={role} />}
        </section>
      </div>
    </div>
  );
}
