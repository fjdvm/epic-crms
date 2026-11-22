"use client";

import { useState } from "react";
import { Star } from "lucide-react";

import { BackButton } from "@/components/shared/back-button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

import { ActivityTimeline } from "./activity-timeline";
import { CartTab } from "./cart-tab";
import { FeedbackTab } from "./feedback-tab";
import { Field } from "./field";
import { formatAgo, formatDate, formatMonthYear, formatPesos } from "./format";
import { orderAnchor } from "./orders";
import { NotesTab, type VisibleCustomerNote } from "./notes-tab";
import { TasksTab, manilaToday, openFirst, type TaskViewer, type VisibleCustomerTask } from "./tasks-tab";
import { OrdersTab } from "./orders-tab";
import { ReturnsTab } from "./returns-tab";
import type { CustomerProfile } from "./profile";
import { StageBadge } from "./stage-badge";
import { TabCard } from "./tab-card";

function Stat({
  title,
  value,
  note,
}: {
  title: string;
  value: string;
  note?: string;
}) {
  return (
    <div className="flex h-full min-w-0 flex-col gap-1.5 rounded-xl border border-border bg-card px-5 py-4">
      <p className="text-[13px] font-medium text-muted-foreground">{title}</p>
      <p className="text-2xl font-semibold leading-[normal] text-foreground">
        {value}
      </p>
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
    </div>
  );
}

const TAB_TRIGGER =
  "rounded-lg px-3.5 py-2 text-sm text-muted-foreground data-[state=active]:bg-accent data-[state=active]:text-primary data-[state=active]:shadow-none";

export function CustomerProfileView({
  profile,
  now = new Date(),
  canOpenOrder = false,
  canViewReturns = false,
  noteAuthor,
  taskViewer,
}: {
  profile: CustomerProfile;
  now?: Date;
  canOpenOrder?: boolean;
  /** Staff with the Returns Module get the Returns tab. */
  canViewReturns?: boolean;
  noteAuthor?: { id: string; name: string };
  /** Staff and Managers only; Admin and CEO see Tasks without controls. */
  taskViewer?: TaskViewer;
}) {
  const p = profile;
  const [addedNotes, setAddedNotes] = useState<VisibleCustomerNote[]>([]);
  const notes = p.notes == null && addedNotes.length === 0 ? p.notes : [
    ...(p.notes ?? []).filter(note => !addedNotes.some(added => added.id === note.id)), ...addedNotes,
  ];
  function changeNote(id: string, note: VisibleCustomerNote | null) {
    setAddedNotes(old => [...old.filter(item => item.id !== id && item.id !== note?.id), ...(note ? [note] : [])]);
  }
  const [taskOverrides, setTaskOverrides] = useState<Map<string, VisibleCustomerTask | null>>(new Map());
  const tasks: VisibleCustomerTask[] | null = p.tasks === null ? null : [
    ...(p.tasks ?? []).filter(task => !taskOverrides.has(task.id)),
    ...[...taskOverrides.values()].filter((task): task is VisibleCustomerTask => task !== null),
  ];
  function changeTask(id: string, task: VisibleCustomerTask | null) {
    setTaskOverrides(old => new Map(old).set(id, task));
  }
  const openTasks = tasks ? openFirst(tasks.map(task => ({ ...task, overdue: !task.doneAt && task.dueDate < manilaToday(now) }))).filter(task => !task.doneAt) : [];
  const [tab, setTab] = useState("orders");
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(new Set());

  function toggleOrder(id: number) {
    setExpanded((open) => {
      const next = new Set(open);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  function openOrder(id: number) {
    setExpanded((open) => new Set(open).add(id));
    setTab("orders");
    requestAnimationFrame(() =>
      document
        .getElementById(orderAnchor(id))
        ?.scrollIntoView({ block: "start" }),
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-5 overflow-hidden">
      <div className="shrink-0 self-start"><BackButton fallbackHref="/customer-profiles" label="Customer Profiles" /></div>

      <div className="max-h-[35dvh] shrink-0 space-y-5 overflow-y-auto xl:max-h-none">

      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2.5">
          <h1 className="text-2xl font-semibold leading-[normal] text-foreground">
            {p.name}
          </h1>
          <StageBadge stage={p.stage} />
        </div>
        <p className="text-sm text-muted-foreground">
          Customer since {formatMonthYear(p.customerSince)} · {p.email} ·{" "}
          {p.contactNumber} · {p.defaultCity ?? "No default city"}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          title="Total spent"
          value={formatPesos(p.totalSpent)}
          note={`From ${p.orders} ${p.orders === 1 ? "order" : "orders"}`}
        />
        <Stat
          title="Average order"
          value={
            p.averageOrder === null
              ? "No paid orders"
              : formatPesos(p.averageOrder)
          }
        />
        <Stat
          title="Last order"
          value={p.lastOrder ? formatDate(p.lastOrder) : "No orders yet"}
          note={p.lastOrder ? formatAgo(p.lastOrder, now) : undefined}
        />
        <Stat
          title="Feedback given"
          value={
            p.averageRating === null
              ? "No feedback"
              : `${p.averageRating.toFixed(1)} ★`
          }
          note={`${p.feedbackCount} ${p.feedbackCount === 1 ? "review" : "reviews"}`}
        />
      </div>

      {openTasks.length > 0 && (
        <section aria-label="Open Tasks" className="space-y-1.5 rounded-xl border border-border bg-card px-5 py-3">
          <h2 className="text-[13px] font-medium text-muted-foreground">Open Tasks</h2>
          <ul className="space-y-1">
            {openTasks.map(task => <li key={task.id} className="flex flex-wrap gap-x-2 text-sm text-foreground">
              <span>{task.description}</span>
              <span className={task.overdue ? "font-semibold text-destructive" : "text-muted-foreground"}>{task.overdue ? "Overdue · " : ""}Due {task.dueDate} · {task.ownerName}</span>
            </li>)}
          </ul>
        </section>
      )}

      </div>

      <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col gap-5">
        <TabsList className="h-auto shrink-0 flex-wrap justify-start gap-1 bg-transparent p-0">
          <TabsTrigger className={TAB_TRIGGER} value="orders">
            Orders ({p.orders})
          </TabsTrigger>
          {canViewReturns && (
            <TabsTrigger className={TAB_TRIGGER} value="returns">
              Returns{p.returns && ` (${p.returns.length})`}
            </TabsTrigger>
          )}
          <TabsTrigger className={TAB_TRIGGER} value="cart">
            Cart
          </TabsTrigger>
          <TabsTrigger className={TAB_TRIGGER} value="feedback">
            Feedback ({p.feedbackCount})
          </TabsTrigger>
          <TabsTrigger className={TAB_TRIGGER} value="notes">
            Notes &amp; tasks
          </TabsTrigger>
          <TabsTrigger className={TAB_TRIGGER} value="details">
            Details
          </TabsTrigger>
        </TabsList>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto xl:flex-row xl:items-stretch xl:overflow-hidden">
          <div className="h-[min(420px,60dvh)] min-h-[320px] min-w-0 w-full shrink-0 overflow-y-auto xl:h-auto xl:min-h-0 xl:flex-1 [&>[role=tabpanel]>div]:h-full [&>[role=tabpanel]]:h-full">
            <TabsContent value="orders" className="mt-0">
              <OrdersTab
                orders={p.orderHistory}
                expanded={expanded}
                onToggle={toggleOrder}
                canOpenOrder={canOpenOrder}
              />
            </TabsContent>

            {canViewReturns && (
              <TabsContent value="returns" className="mt-0">
                <ReturnsTab returns={p.returns} canOpenOrder={canOpenOrder} />
              </TabsContent>
            )}

            <TabsContent value="cart" className="mt-0">
              <CartTab cart={p.cart} />
            </TabsContent>

            <TabsContent value="feedback" className="mt-0">
              <FeedbackTab orders={p.orderHistory} onOpenOrder={openOrder} />
            </TabsContent>

            <TabsContent forceMount value="notes" className="mt-0 space-y-4 data-[state=inactive]:hidden">
              <TasksTab customerId={p.id} tasks={tasks} viewer={taskViewer} now={now} onTaskChange={changeTask} />
              <NotesTab customerId={p.id} notes={notes} readFailed={p.notes === null} author={noteAuthor} onNoteChange={changeNote} />
            </TabsContent>

            <TabsContent value="details" className="mt-0">
              <TabCard title="Details" scroll>
                <dl className="grid gap-md sm:grid-cols-2 lg:grid-cols-3">
                  <Field label="First name">{p.firstName}</Field>
                  <Field label="Middle name">{p.middleName ?? "—"}</Field>
                  <Field label="Last name">{p.lastName}</Field>
                  <Field label="Email">{p.email}</Field>
                  <Field label="Contact number">{p.contactNumber}</Field>
                  <Field label="Customer since">
                    {formatDate(p.customerSince)}
                  </Field>
                </dl>

                <section aria-label="Addresses" className="space-y-[14px] border-t border-border pt-5">
                <h3 className="text-sm font-semibold text-foreground">Addresses</h3>
                {p.addresses.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No addresses saved.
                  </p>
                ) : (
                  <ul className="grid gap-md sm:grid-cols-2">
                    {p.addresses.map((a) => (
                      <li
                        key={a.id}
                        className={cn("space-y-1 rounded-lg bg-secondary p-md")}
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">{a.label}</span>
                          {a.isDefault && (
                            <Badge variant="purple">
                              <Star className="mr-1 size-3" /> Default address
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm text-foreground">
                          {a.street}, {a.barangay}, {a.city}, {a.province}{" "}
                          {a.postalCode}, {a.country}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
                </section>
              </TabCard>
            </TabsContent>
          </div>

          <aside className="min-h-0 w-full shrink-0 xl:w-[380px] xl:overflow-y-auto [&>div]:h-full">
            <ActivityTimeline notes={notes ?? []} tasks={tasks ?? []} orders={p.orderHistory} onOpenOrder={openOrder} />
          </aside>
        </div>
      </Tabs>
    </div>
  );
}
