"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { formatDate } from "./format";
import { markCustomerTaskDone } from "./task-actions";
import type { MyTask, MyTasks } from "./my-tasks";

const GRID = "grid grid-cols-[minmax(0,2.4fr)_minmax(0,1.2fr)_minmax(0,0.9fr)_8rem] items-center gap-4 px-5";
const manilaToday = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" });

function dueLabel(task: MyTask, today: string): { text: string; overdue: boolean } {
  if (task.overdue) return { text: "Overdue", overdue: true };
  if (task.dueDate === today) return { text: "Today", overdue: false };
  const tomorrow = manilaToday.format(new Date(new Date(`${today}T00:00:00+08:00`).getTime() + 86_400_000));
  if (task.dueDate === tomorrow) return { text: "Tomorrow", overdue: false };
  return { text: formatDate(new Date(`${task.dueDate}T00:00:00+08:00`)), overdue: false };
}

export function MyTasksChrome() {
  return (
    <div className="shrink-0 space-y-1">
      <h1 className="text-2xl font-semibold leading-[normal] text-foreground">My tasks</h1>
      <p className="text-sm text-muted-foreground">Follow-ups you have set for Customers, soonest first.</p>
    </div>
  );
}

function CountCard({ label, value, tone }: { label: string; value: number | null; tone?: "danger" }) {
  return (
    <div className="rounded-xl border border-border bg-card px-5 py-4">
      <p className="text-sm text-foreground">{label}</p>
      {value === null ? <Skeleton className="mt-1 h-8 w-10" /> : <p className={cn("text-[28px] font-semibold leading-tight", tone === "danger" && value > 0 && "text-destructive")}>{value}</p>}
    </div>
  );
}

export function MyTasksSkeleton() {
  return (
    <div role="status" aria-label="Loading My tasks" className="flex min-h-0 flex-1 flex-col gap-5">
      <div className="grid shrink-0 grid-cols-3 gap-3">
        <CountCard label="Due today" value={null} />
        <CountCard label="Overdue" value={null} />
        <CountCard label="Done this week" value={null} />
      </div>
      <div className="min-h-0 flex-1 overflow-hidden rounded-xl border border-border bg-card">
        <TableHead />
        {Array.from({ length: 5 }, (_, i) => <div key={i} className={cn(GRID, "border-b border-border-subtle py-4 last:border-0")}><Skeleton className="h-4 w-4/5" /><Skeleton className="h-4 w-2/3" /><Skeleton className="h-4 w-1/2" /><Skeleton className="h-8 w-24" /></div>)}
      </div>
    </div>
  );
}

function TableHead() {
  return <div className={cn(GRID, "border-b border-border-subtle py-2.5 text-xs font-medium text-muted-foreground")}><span>Task</span><span>Customer</span><span>Due</span><span /></div>;
}

export function MyTasksView({ data, canMarkDone }: { data: MyTasks; canMarkDone: boolean }) {
  const [done, setDone] = useState<ReadonlySet<string>>(new Set());
  const [asking, setAsking] = useState<MyTask | null>(null);
  const [error, setError] = useState("");
  // One operation id per Task keeps a retry after a lost response from marking it twice.
  const operations = useRef(new Map<string, string>());
  const today = manilaToday.format(new Date());

  // A confirmed Task leaves the page props after revalidation; until then it is counted here.
  const marked = data.tasks.filter(task => done.has(task.id));
  const rows = data.tasks.filter(task => !done.has(task.id));
  const counts = {
    dueToday: data.counts.dueToday - marked.filter(task => !task.overdue && task.dueDate === today).length,
    overdue: data.counts.overdue - marked.filter(task => task.overdue).length,
    doneThisWeek: data.counts.doneThisWeek + marked.length,
  };

  async function markDone(task: MyTask) {
    setAsking(null);
    setError("");
    setDone(prev => new Set(prev).add(task.id));
    let reason = "";
    try {
      if (!operations.current.has(task.id)) operations.current.set(task.id, crypto.randomUUID());
      const result = await markCustomerTaskDone(task.customerId, task.id, operations.current.get(task.id)!);
      if (!result.ok) reason = result.message;
    } catch {
      reason = "My tasks could not reach the server. Try again.";
    }
    if (reason) {
      setDone(prev => { const next = new Set(prev); next.delete(task.id); return next; });
      setError(`"${task.description}" is still open. ${reason}`);
    } else operations.current.delete(task.id);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5">
      <div className="grid shrink-0 grid-cols-3 gap-3">
        <CountCard label="Due today" value={counts.dueToday} />
        <CountCard label="Overdue" value={counts.overdue} tone="danger" />
        <CountCard label="Done this week" value={counts.doneThisWeek} />
      </div>
      {error && <p role="alert" className="shrink-0 text-sm text-destructive">{error}</p>}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-card">
        {rows.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <p className="text-sm font-medium text-foreground">You&apos;re all caught up</p>
            <p className="mt-1 text-sm text-muted-foreground">No open tasks. New follow-ups from a Customer Profile will appear here.</p>
          </div>
        ) : (
          <>
            <TableHead />
            <ul aria-label="Open tasks" className="min-h-0 overflow-y-auto">
              {rows.map(task => {
                const due = dueLabel(task, today);
                return (
                  <li key={task.id} className={cn(GRID, "border-b border-border-subtle py-3.5 text-[13px] last:border-0", due.overdue && "bg-destructive/5")}>
                    <span className="break-words text-foreground">{task.description}</span>
                    <Link href={`/customer-profiles/${task.customerId}`} className="truncate font-semibold text-foreground hover:underline">{task.customerName}</Link>
                    <span className={cn(due.overdue ? "font-medium text-destructive" : "text-foreground")}>{due.text}</span>
                    <span className="justify-self-end">{canMarkDone && <Button variant="outline" size="sm" onClick={() => setAsking(task)}>Mark done</Button>}</span>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
      <AlertDialog open={asking !== null} onOpenChange={open => { if (!open) setAsking(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Mark this task done?</AlertDialogTitle>
            <AlertDialogDescription>{asking?.description} · {asking?.customerName}. You can reopen it from the Customer Profile.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => asking && void markDone(asking)}>Mark done</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
