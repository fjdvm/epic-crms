"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

import { CELL, COLUMNS } from "./ticket-layout";
import { ClaimProvider, useClaim } from "./claim";
import { listTicketNotes, type TicketNote } from "./actions";
import { EscalateDialog } from "./escalate-ui";
import { NoteBox, NotesProvider } from "./notes";
import { PILL, Pill, PRIORITY_LABELS, PRIORITY_PILLS } from "./pill";
import { describeClock, type Clock } from "./service-level";
import type { AssignableStaff } from "./staffs";
import type { TicketRow } from "./tickets";

export interface RowsViewer {
  id: string;
  name: string;
  /** Staff only claim themselves; a Manager assigns anyone. Admin view. */
  role: "staff" | "manager" | "admin" | null;
}

function ServiceCell({ clock }: { clock: Clock }) {
  const tone =
    clock.state === "missed" ? "text-[#b91c1c]"
    : clock.state === "breaching" ? "text-[#b45309]"
    : clock.state === "met" ? "text-[#15803d]"
    : "text-[#6e6680]";

  return <span className={cn("font-medium", tone)}>{describeClock(clock)}</span>;
}

function StatusPill({ row }: { row: TicketRow }) {
  if (row.status === "resolved") return <Pill className={PILL.green}>Resolved</Pill>;
  if (row.status === "completed") return <Pill className={PILL.green}>Completed</Pill>;
  if (row.overdue) return <Pill className={PILL.red}>Overdue</Pill>;
  if (row.waiting) return <Pill className={PILL.amber}>Waiting</Pill>;

  return <Pill className={PILL.red}>Open</Pill>;
}

function activityLabel(row: TicketRow): { dot: string; text: string } {
  if (row.status === "completed" || row.status === "resolved") return { dot: "bg-[#6e6680]", text: "Closed" };
  if (row.status === "on_hold") return { dot: "bg-[#b45309]", text: "On hold" };
  if (row.waiting) return { dot: "bg-[#15803d]", text: "Awaiting customer response" };

  return { dot: "bg-[#b91c1c]", text: row.claimedById === null ? "Unread" : "Customer replied" };
}

function ago(at: Date, now: number): string {
  const minutes = Math.max(0, Math.floor((now - new Date(at).getTime()) / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} mins ago`;
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)} hours ago`;

  return `${Math.floor(minutes / (24 * 60))} days ago`;
}

/** Whether the viewer may open this Ticket's Conversation: Staff only their own or unclaimed ones, everyone else any. */
export function canOpenConversation(row: TicketRow, viewer: RowsViewer): boolean {
  if (viewer.role === null) return false;
  if (viewer.role !== "staff") return true;
  if (row.status !== "open" && row.status !== "on_hold") return false;

  return row.claimedById === null || row.claimedById === viewer.id;
}

/** Internal notes on the open Ticket, read when the drawer opens and after each note is saved; never on a timer. */
function DrawerNotes({ ticketId, canNote, refreshKey }: { ticketId: number; canNote: boolean; refreshKey: number }) {
  const [notes, setNotes] = useState<TicketNote[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    listTicketNotes(ticketId).then((r) => {
      if (!live) return;
      setFailed(r.ok ? null : r.reason === "forbidden" ? "These notes belong to a Ticket another teammate holds." : "Notes could not be loaded.");
      if (r.ok) setNotes(r.notes);
    }).catch(() => { if (live) setFailed("Notes could not be loaded."); });

    return () => { live = false; };
  }, [ticketId, refreshKey]);

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-medium text-[#6e6680]">Internal notes</p>
      {notes === null && failed === null && <p className="text-sm text-[#6e6680]">Loading notes…</p>}
      {failed && <p className="text-sm text-[#9a3412]">{failed}</p>}
      {notes?.length === 0 && <p className="text-sm text-[#6e6680]">No notes yet.</p>}
      <ul className="flex flex-col gap-2">
        {notes?.map((n) => (
          <li key={n.id} className="rounded-lg border border-dashed border-[#e0c97a] bg-[#fff8e1] p-2 text-sm">
            <p className="text-xs text-[#7a5b00]">{n.authorName} · {new Date(n.at).toLocaleString()}</p>
            <p className="whitespace-pre-wrap">{n.body}</p>
          </li>
        ))}
      </ul>
      {canNote && <NoteBox />}
    </div>
  );
}

function TicketDrawerBody({ row, viewer, staffs, now }: { row: TicketRow; viewer: RowsViewer; staffs: AssignableStaff[]; now: number }) {
  const server = row.claimedById === null ? null : { id: row.claimedById, name: row.claimedByName ?? row.claimedById };
  const [saved, setSaved] = useState(0);
  const bump = useCallback(() => setSaved((n) => n + 1), []);

  return (
    <ClaimProvider ticketId={row.id} claimer={server} viewer={{ id: viewer.id, name: viewer.name }}>
      <NotesProvider ticketId={row.id} viewerName={viewer.name} onSaved={bump}>
        <TicketDrawerContent row={row} viewer={viewer} staffs={staffs} now={now} savedNotes={saved} />
      </NotesProvider>
    </ClaimProvider>
  );
}

function TicketDrawerContent({ row, viewer, staffs, now, savedNotes }: { row: TicketRow; viewer: RowsViewer; staffs: AssignableStaff[]; now: number; savedNotes: number }) {
  const claim = useClaim();
  const canWork = viewer.role === "staff" || viewer.role === "manager";
  const manager = viewer.role === "manager";
  const open = row.status !== "completed";
  const [target, setTarget] = useState<AssignableStaff | null>(null);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto">
      <div className="flex flex-col gap-1">
        <SheetTitle className="text-lg font-semibold text-[#1f1a2e]">
          (#{row.id}) {row.subject}
        </SheetTitle>
        <SheetDescription className="text-sm text-[#6e6680]">
          {row.customerName} · {row.orderId === null ? "No linked order" : `Order #${row.orderId}`} · {row.category}
        </SheetDescription>
      </div>

      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div><dt className="text-xs text-[#6e6680]">Status</dt><dd className="mt-1 flex flex-wrap gap-1"><StatusPill row={row} />{row.escalated && row.status !== "completed" && <Pill className={PILL.red}>Escalated</Pill>}</dd></div>
        <div><dt className="text-xs text-[#6e6680]">Priority</dt><dd className="mt-1"><Pill className={PRIORITY_PILLS[row.priority]}>{PRIORITY_LABELS[row.priority]}</Pill></dd></div>
        <div><dt className="text-xs text-[#6e6680]">Service level</dt><dd className="mt-1"><ServiceCell clock={row.serviceLevel.current} /></dd></div>
        <div><dt className="text-xs text-[#6e6680]">Created</dt><dd className="mt-1">{ago(row.createdAt, now)}</dd></div>
        <div><dt className="text-xs text-[#6e6680]">Last activity</dt><dd className="mt-1">{ago(row.lastActivity, now)}</dd></div>
        <div className="col-span-2"><dt className="text-xs text-[#6e6680]">Assigned to</dt><dd className="mt-1 font-medium">{claim.claimer?.name ?? "Unassigned"}</dd></div>
      </dl>

      {open && (
        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            {claim.claimer === null && viewer.role !== null && viewer.role !== "admin" && (
              <button type="button" disabled={claim.pending} onClick={claim.claim} className="rounded-lg bg-[#5b2a86] px-[14px] py-[9px] text-sm font-medium text-white disabled:opacity-50">Claim</button>
            )}
            {claim.isClaimer && !claim.escalation && !row.escalated && <EscalateDialog ticketId={row.id} />}
            {claim.isClaimer && (
              <button type="button" disabled={claim.pending} onClick={claim.release} className="rounded-lg border border-[#e6e1ee] bg-white px-[14px] py-[9px] text-sm font-medium text-[#1f1a2e] disabled:opacity-50">Release</button>
            )}
          </div>

          {manager ? (
            <div className="flex flex-col gap-1">
              <p className="text-xs font-medium text-[#6e6680]">Assign to</p>
              {staffs.length === 0 && <p className="text-sm text-[#6e6680]">No one is available to assign.</p>}
              {staffs.length > 0 && (
                <Select
                  value=""
                  disabled={claim.pending}
                  onValueChange={(id) => setTarget(staffs.find((s) => s.id === id) ?? null)}
                >
                  <SelectTrigger aria-label="Assign to" className="bg-white text-[#1f1a2e]">
                    <SelectValue placeholder="Choose a staff member" />
                  </SelectTrigger>
                  <SelectContent>
                    {staffs.map((s) => (
                      <SelectItem key={s.id} value={s.id} disabled={claim.claimer?.id === s.id}>
                        {s.name} · {s.role === "manager" ? "Manager" : "Staff"} · {s.open} open
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {target && (
                <div role="alertdialog" aria-label="Confirm assign" className="mt-2 flex flex-col gap-2 rounded-lg border border-[#e6e1ee] p-3 text-sm">
                  <p>Assign TKT-{row.id} to {target.name}?</p>
                  <div className="flex gap-2">
                    <button type="button" disabled={claim.pending} onClick={() => { claim.reassign({ id: target.id, name: target.name }, ""); setTarget(null); }} className="rounded-lg bg-[#5b2a86] px-3 py-1.5 font-medium text-white disabled:opacity-50">Confirm</button>
                    <button type="button" onClick={() => setTarget(null)} className="rounded-lg border border-[#e6e1ee] bg-white px-3 py-1.5 font-medium">Cancel</button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            viewer.role === "staff" && claim.claimer !== null && !claim.isClaimer && (
              <p className="text-sm text-[#6e6680]">Request approval from a Manager to assign this Ticket to someone else.</p>
            )
          )}
        </div>
      )}

      <DrawerNotes ticketId={row.id} canNote={canWork} refreshKey={savedNotes} />

      <div className="mt-auto flex flex-col gap-2">
        <Link href={`/tickets/${row.id}`} prefetch className="rounded-lg border border-[#e4e4e7] bg-white px-[14px] py-[10px] text-center text-sm font-medium text-[#18181b]">
          Open full page
        </Link>
        {canOpenConversation(row, viewer) && (
          <Link href={`/conversations?ticket=${row.id}${row.claimedById === null ? "&tab=unclaimed" : ""}`} prefetch className="rounded-lg bg-[#5b2a86] px-[14px] py-[10px] text-center text-sm font-medium text-white">
            Open conversation
          </Link>
        )}
      </div>
    </div>
  );
}

/** The rows of the Tickets list. A click opens that Ticket in a drawer, with no page change. */
export function TicketRows({ rows, viewer, staffs, now, openId = null }: { rows: TicketRow[]; viewer: RowsViewer; staffs: AssignableStaff[]; now: number; openId?: number | null }) {
  const [selected, setSelected] = useState<number | null>(openId);
  const row = rows.find((r) => r.id === selected) ?? null;

  const choose = (id: number | null) => {
    setSelected(id);
    try {
      const url = new URL(window.location.href);
      if (id === null) url.searchParams.delete("ticket");
      else url.searchParams.set("ticket", String(id));
      window.history.replaceState(null, "", url);
    } catch {
      // The address is only a convenience.
    }
  };

  return (
    <>
      {rows.map((r) => {
        const activity = activityLabel(r);

        return (
          <div
            key={r.id}
            role="button"
            tabIndex={0}
            aria-label={`Open TKT-${r.id}`}
            onClick={() => choose(r.id)}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); choose(r.id); } }}
            className="flex cursor-pointer items-center border-b border-[#efebf4] py-[11px] hover:bg-[#faf8fc]"
          >
            <div className={cn(CELL, COLUMNS[0].className, "flex-col items-start gap-1 pr-3")}>
              <span className="max-w-full truncate font-medium">(#{r.id}) {r.subject}</span>
              <span className="max-w-full truncate text-xs text-[#6e6680]"><span className="text-[#5b2a86]">{r.customerName}</span> · {r.orderId === null ? "No order" : `Order #${r.orderId}`} · {r.category}</span>
              <span className="text-xs text-[#6e6680]">Created {ago(r.createdAt, now)} · Modified {ago(r.lastActivity, now)}</span>
            </div>
            <div className={cn(CELL, COLUMNS[1].className)}><ServiceCell clock={r.serviceLevel.current} /></div>
            <div className={cn(CELL, COLUMNS[2].className)}>
              {r.claimedById === null ? <span className="font-medium text-[#b45309]">Assign</span> : <span className="truncate pr-3">{r.claimedByName ?? r.claimedById}</span>}
            </div>
            <div className={cn(CELL, COLUMNS[3].className)}><Pill className={PRIORITY_PILLS[r.priority]}>{PRIORITY_LABELS[r.priority]}</Pill></div>
            <div className={cn(CELL, COLUMNS[4].className)}>
              <span className="flex items-center gap-1.5"><span aria-hidden className={cn("size-1.5 rounded-full", activity.dot)} />{activity.text}</span>
            </div>
            <div className={cn(CELL, COLUMNS[5].className)}>
              <span className="flex flex-wrap items-center gap-1">
                <StatusPill row={r} />
                {r.escalated && r.status !== "completed" && <Pill className={PILL.red}>Escalated</Pill>}
              </span>
            </div>
          </div>
        );
      })}

      <Sheet open={row !== null} onOpenChange={(o) => { if (!o) choose(null); }}>
        <SheetContent side="right" className="flex w-[440px] flex-col gap-4 bg-white">
          {row && <TicketDrawerBody key={row.id} row={row} viewer={viewer} staffs={staffs} now={now} />}
        </SheetContent>
      </Sheet>
    </>
  );
}
