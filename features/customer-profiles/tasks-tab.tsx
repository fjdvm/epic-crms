"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { changeCustomerTaskDueDate, createCustomerTask, listTaskOwners, markCustomerTaskDone, reassignCustomerTask, reopenCustomerTask } from "./task-actions";
import type { CustomerTask } from "./tasks";
import { TabCard } from "./tab-card";

export type VisibleCustomerTask = CustomerTask & { saving?: boolean };
export type TaskViewer = { id: string; name: string; role: "staff" | "manager" };

/** Philippine Time calendar date, as the server uses for "overdue". */
export function manilaToday(now: Date = new Date()): string {
  return new Date(now.getTime() + 8 * 3_600_000).toISOString().slice(0, 10);
}
const dateLabel = (value: string) => new Date(`${value}T00:00:00Z`).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
export const openFirst = <T extends CustomerTask>(tasks: T[]): T[] => [...tasks].sort((a, b) =>
  Number(!!a.doneAt) - Number(!!b.doneAt) || a.dueDate.localeCompare(b.dueDate) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));

type Pending =
  | { kind: "done" | "reopen"; task: VisibleCustomerTask }
  | { kind: "due"; task: VisibleCustomerTask }
  | { kind: "reassign"; task: VisibleCustomerTask }
  | { kind: "create" };

export function TasksTab({ customerId, tasks, viewer, now, onTaskChange }: {
  customerId: string;
  /** Undefined while loading; null means the read failed. */
  tasks: VisibleCustomerTask[] | null | undefined;
  /** Only Staff and Managers receive a viewer; Admin and CEO see Tasks without controls. */
  viewer?: TaskViewer;
  now?: Date;
  onTaskChange: (id: string, task: VisibleCustomerTask | null) => void;
}) {
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);
  const [newDate, setNewDate] = useState("");
  const [owners, setOwners] = useState<{ id: string; name: string }[] | null>(null);
  const [ownerId, setOwnerId] = useState("");
  const [error, setError] = useState("");
  const [formError, setFormError] = useState("");
  const create = useRef<{ id: string; key: string } | null>(null);
  const busy = useRef(new Set<string>());
  const manager = viewer?.role === "manager";
  const today = manilaToday(now);
  const withOverdue = <T extends CustomerTask>(task: T): T => ({ ...task, overdue: !task.doneAt && task.dueDate < today });

  function askToCreate() {
    if (!description.trim()) return setFormError("Write a Task description.");
    if (Array.from(description.trim()).length > 200) return setFormError("A Task description can have at most 200 characters.");
    if (!dueDate) return setFormError("Choose a due date.");
    setFormError("");
    setPending({ kind: "create" });
  }
  async function openDialog(next: Pending) {
    setError("");
    if (next.kind === "due") setNewDate(next.task.dueDate);
    if (next.kind === "reassign") {
      setOwnerId("");
      setPending(next);
      if (!owners) {
        const result = await listTaskOwners();
        if (result.ok) setOwners(result.owners);
        else { setPending(null); setError(result.message); }
      }
      return;
    }
    setPending(next);
  }

  /** Update at once, then reconcile with the server or roll back to `before`. */
  async function run(id: string, before: VisibleCustomerTask | null, optimistic: VisibleCustomerTask, call: () => Promise<{ ok: true; task: CustomerTask } | { ok: false; message: string }>) {
    if (busy.current.has(id)) return;
    busy.current.add(id);
    onTaskChange(id, optimistic);
    try {
      const result = await call();
      if (result.ok) {
        onTaskChange(id, null);
        onTaskChange(result.task.id, result.task);
      } else {
        onTaskChange(id, before);
        setError(result.message);
      }
    } catch {
      onTaskChange(id, before);
      setError("Tasks are unavailable right now. Please try again.");
    } finally {
      busy.current.delete(id);
    }
  }

  async function confirm() {
    const action = pending;
    setPending(null);
    if (!viewer || !action) return;
    setError("");
    if (action.kind === "create") {
      const key = JSON.stringify([description.trim(), dueDate]);
      if (!create.current || create.current.key !== key) create.current = { id: crypto.randomUUID(), key };
      const operationId = create.current.id;
      const text = description.trim();
      const due = dueDate;
      const optimistic: VisibleCustomerTask = withOverdue({ id: operationId, customerId, description: text, dueDate: due, ownerId: viewer.id, ownerName: viewer.name, createdAt: new Date().toISOString(), createdById: viewer.id, createdByName: viewer.name, doneAt: null, doneById: null, doneByName: null, overdue: false });
      setDescription(""); setDueDate("");
      await run(operationId, null, { ...optimistic, saving: true }, async () => {
        const result = await createCustomerTask(customerId, { description: text, dueDate: due }, operationId);
        if (result.ok) create.current = null;
        else { setDescription(text); setDueDate(due); create.current = null; }
        return result;
      });
      return;
    }
    const { task } = action;
    const operationId = crypto.randomUUID();
    const stamp = new Date().toISOString();
    if (action.kind === "done") return run(task.id, task, { ...task, doneAt: stamp, doneById: viewer.id, doneByName: viewer.name, overdue: false, saving: true }, () => markCustomerTaskDone(customerId, task.id, operationId));
    if (action.kind === "reopen") return run(task.id, task, withOverdue({ ...task, doneAt: null, doneById: null, doneByName: null, saving: true }), () => reopenCustomerTask(customerId, task.id, operationId));
    if (action.kind === "due") {
      if (!newDate) return setError("Choose a due date.");
      return run(task.id, task, withOverdue({ ...task, dueDate: newDate, saving: true }), () => changeCustomerTaskDueDate(customerId, task.id, newDate, operationId));
    }
    const owner = owners?.find(person => person.id === ownerId);
    if (!owner) return setError("Choose who the Task moves to.");
    return run(task.id, task, { ...task, ownerId: owner.id, ownerName: owner.name, saving: true }, () => reassignCustomerTask(customerId, task.id, owner, operationId));
  }

  const list: VisibleCustomerTask[] = tasks ? openFirst(tasks.map(withOverdue)) : [];
  const openCount = list.filter(task => !task.doneAt).length;
  const dialog = pending && (pending.kind === "create"
    ? { title: "Add this Task?", body: `“${description.trim()}” due ${dueDate ? dateLabel(dueDate) : ""}. It will be yours.`, action: "Add Task" }
    : pending.kind === "done" ? { title: "Mark this Task done?", body: pending.task.description, action: "Mark done" }
    : pending.kind === "reopen" ? { title: "Reopen this Task?", body: pending.task.description, action: "Reopen" }
    : pending.kind === "due" ? { title: "Change the due date?", body: pending.task.description, action: "Change due date" }
    : { title: "Reassign this Task?", body: `${pending.task.description} — currently ${pending.task.ownerName}.`, action: "Reassign" });

  return (
    <TabCard title="Tasks">
      {viewer && <form noValidate onSubmit={event => { event.preventDefault(); askToCreate(); }} className="shrink-0 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Input aria-label="Task description" maxLength={400} placeholder="Add a Task… e.g. Check the replacement arrived sealed" value={description} onChange={event => setDescription(event.target.value)} className="min-w-48 flex-1" />
          <Input aria-label="Task due date" type="date" required value={dueDate} onChange={event => setDueDate(event.target.value)} className="w-auto" />
          <Button type="submit" variant="secondary" size="sm">Add task</Button>
        </div>
        {formError && <p role="alert" className="text-sm text-destructive">{formError}</p>}
      </form>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {tasks === undefined ? <div role="status" aria-label="Loading Tasks" className="space-y-3"><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /></div>
        : tasks === null ? <p role="alert" className="text-sm text-muted-foreground">Tasks are unavailable. Reload to try again.</p>
        : <>
          {openCount === 0 && <p className="text-sm text-muted-foreground">No open Tasks</p>}
          {list.length > 0 && <ol aria-label="Tasks" className="min-h-0 space-y-2 overflow-y-auto">
            {list.map(task => {
              const mine = viewer?.id === task.ownerId;
              const canChange = !!viewer && !task.saving && (manager || mine);
              return <li key={task.id} data-overdue={task.overdue || undefined} className={`flex flex-wrap items-center justify-between gap-2 rounded-lg px-3.5 py-3 ${task.overdue ? "border border-destructive/40 bg-destructive/10" : "bg-secondary"} ${task.doneAt ? "opacity-70" : ""}`}>
                <div className="min-w-0 space-y-0.5">
                  <p className={`break-words text-[13px] text-foreground ${task.doneAt ? "line-through" : ""}`}>{task.description}</p>
                  <p className="text-xs text-muted-foreground">
                    <span className={task.overdue ? "font-semibold text-destructive" : ""}>{task.overdue ? "Overdue · " : ""}Due {dateLabel(task.dueDate)}</span> · {task.ownerName}
                    {task.doneAt && ` · Done by ${task.doneByName}`}
                    {task.saving && <span role="status"> · saving…</span>}
                  </p>
                </div>
                {viewer && <div className="flex flex-wrap gap-1.5">
                  {canChange && (task.doneAt
                    ? <Button size="sm" variant="outline" onClick={() => void openDialog({ kind: "reopen", task })}>Reopen</Button>
                    : <>
                      <Button size="sm" variant="outline" onClick={() => void openDialog({ kind: "done", task })}>Mark done</Button>
                      <Button size="sm" variant="outline" onClick={() => void openDialog({ kind: "due", task })}>Change due date</Button>
                    </>)}
                  {!task.doneAt && !task.saving && (manager
                    ? <Button size="sm" variant="outline" onClick={() => void openDialog({ kind: "reassign", task })}>Reassign</Button>
                    : <Button size="sm" variant="outline" disabled title="Approval requests for Tasks are not available yet">Request approval</Button>)}
                </div>}
              </li>;
            })}
          </ol>}
        </>}
      <AlertDialog open={!!pending} onOpenChange={open => { if (!open) setPending(null); }}>
        <AlertDialogContent>
          {dialog && <>
            <AlertDialogHeader><AlertDialogTitle>{dialog.title}</AlertDialogTitle><AlertDialogDescription>{dialog.body}</AlertDialogDescription></AlertDialogHeader>
            {pending?.kind === "due" && <Input aria-label="New due date" type="date" value={newDate} onChange={event => setNewDate(event.target.value)} />}
            {pending?.kind === "reassign" && <select aria-label="New owner" value={ownerId} onChange={event => setOwnerId(event.target.value)} className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm">
              <option value="">{owners ? "Choose a person" : "Loading…"}</option>
              {owners?.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}
            </select>}
            <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => void confirm()}>{dialog.action}</AlertDialogAction></AlertDialogFooter>
          </>}
        </AlertDialogContent>
      </AlertDialog>
    </TabCard>
  );
}
