"use client";

import { useState } from "react";
import { Star } from "lucide-react";

import { BackButton } from "@/components/shared/back-button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

import { ActivityTimeline } from "./activity-timeline";
import { CartTab } from "./cart-tab";
import { EmailsTab } from "./emails-tab";
import { FeedbackTab } from "./feedback-tab";
import { Field } from "./field";
import { formatAgo, formatDate, formatMonthYear, formatPesos } from "./format";
import { orderAnchor } from "./orders";
import { OrdersTab } from "./orders-tab";
import { ReturnsTab } from "./returns-tab";
import type { CustomerProfile } from "./profile";
import { StageBadge } from "./stage-badge";
import { TabCard } from "./tab-card";
import { WalkInDetails } from "./walk-in-details";

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
}: {
  profile: CustomerProfile;
  now?: Date;
  canOpenOrder?: boolean;
  /** Staff with the Returns Module get the Returns tab. */
  canViewReturns?: boolean;
}) {
  const p = profile;
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
    <div className="space-y-5">
      <BackButton fallbackHref="/customer-profiles" label="Customer Profiles" />

      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2.5">
          <h1 className="text-2xl font-semibold leading-[normal] text-foreground">
            {p.name}
          </h1>
          <StageBadge stage={p.stage} />
          {p.walkIn && <Badge variant="secondary">Walk-in</Badge>}
        </div>
        <p className="text-sm text-muted-foreground">
          {p.walkIn ? "Added" : "Customer since"} {formatMonthYear(p.customerSince)} · {p.email} ·{" "}
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

      <Tabs value={tab} onValueChange={setTab} className="space-y-5">
        <TabsList className="h-auto flex-wrap justify-start gap-1 bg-transparent p-0">
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
          <TabsTrigger className={TAB_TRIGGER} value="emails">
            Emails
          </TabsTrigger>
          <TabsTrigger className={TAB_TRIGGER} value="details">
            Details
          </TabsTrigger>
        </TabsList>

        <div className="flex flex-col gap-4 xl:flex-row xl:items-stretch">
          <div className="min-w-0 w-full flex-1 [&>[role=tabpanel]>div]:h-full [&>[role=tabpanel]]:h-full">
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

            <TabsContent value="emails" className="mt-0">
              <EmailsTab marketingOptIn={p.marketingOptIn} emails={p.emailsReceived} />
            </TabsContent>

            <TabsContent value="details" className="mt-0 space-y-5">
              {p.walkIn ? (
                <WalkInDetails walkIn={p.walkIn} />
              ) : (
              <>
              <TabCard title="Details">
                <dl className="grid gap-md sm:grid-cols-2 lg:grid-cols-3">
                  <Field label="First name">{p.firstName}</Field>
                  <Field label="Middle name">{p.middleName ?? "—"}</Field>
                  <Field label="Last name">{p.lastName}</Field>
                  <Field label="Email">{p.email}</Field>
                  <Field label="Contact number">{p.contactNumber}</Field>
                  <Field label="Marketing emails">
                    {p.marketingOptIn ? "Opted in" : "Not opted in"}
                  </Field>
                  <Field label="Customer since">
                    {formatDate(p.customerSince)}
                  </Field>
                  {p.mergedWalkIn && (
                    <Field label="Tags">
                      {p.mergedWalkIn.tags.length === 0 ? (
                        "—"
                      ) : (
                        <span className="flex flex-wrap gap-1.5">
                          {p.mergedWalkIn.tags.map((tag) => (
                            <Badge key={tag} variant="purple">{tag}</Badge>
                          ))}
                        </span>
                      )}
                    </Field>
                  )}
                </dl>
              </TabCard>

              {p.mergedWalkIn && (
                <TabCard title="Internal notes" note="Visible to Staff only">
                  <p className="whitespace-pre-wrap text-sm text-foreground">{p.mergedWalkIn.notes ?? "No notes."}</p>
                </TabCard>
              )}

              <TabCard title="Addresses">
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
              </TabCard>
              </>
              )}
            </TabsContent>
          </div>

          <aside className="w-full shrink-0 xl:w-[380px] [&>div]:h-full">
            <ActivityTimeline orders={p.orderHistory} onOpenOrder={openOrder} />
          </aside>
        </div>
      </Tabs>
    </div>
  );
}
