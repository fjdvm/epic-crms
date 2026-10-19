"use client";

import { useState } from "react";
import { Star } from "lucide-react";

import { BackButton } from "@/components/shared/back-button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { CartTab } from "./cart-tab";
import { EmailsTab } from "./emails-tab";
import { FeedbackTab } from "./feedback-tab";
import { Field } from "./field";
import { formatAgo, formatDate, formatPesos } from "./format";
import { OrdersTab } from "./orders-tab";
import type { CustomerProfile } from "./profile";
import { STAGE_LABELS } from "./rules";

function Stat({ title, value, note }: { title: string; value: string; note?: string }) {
  return (
    <Card>
      <CardContent className="space-y-1">
        <p className="text-label-md text-muted-foreground">{title}</p>
        <p className="text-title-lg text-foreground">{value}</p>
        {note && <p className="text-body-sm text-muted-foreground">{note}</p>}
      </CardContent>
    </Card>
  );
}

export function CustomerProfileView({ profile, now = new Date() }: { profile: CustomerProfile; now?: Date }) {
  const p = profile;
  const [tab, setTab] = useState("details");

  function openOrder(id: number) {
    setTab("orders");
    requestAnimationFrame(() => document.getElementById(`order-${id}`)?.scrollIntoView({ block: "start" }));
  }

  return (
    <div className="space-y-md">
      <BackButton fallbackHref="/customer-profiles" label="Customer Profiles" />

      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-headline-md text-foreground">{p.name}</h1>
          <Badge variant="outline">{STAGE_LABELS[p.stage]}</Badge>
        </div>
        <p className="text-body-md text-muted-foreground">
          Customer since {formatDate(p.customerSince)} · {p.email} · {p.contactNumber} ·{" "}
          {p.defaultCity ?? "No default city"}
        </p>
      </div>

      <div className="grid gap-md sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          title="Total spent"
          value={formatPesos(p.totalSpent)}
          note={`${p.orders} ${p.orders === 1 ? "order" : "orders"}`}
        />
        <Stat
          title="Average order"
          value={p.averageOrder === null ? "No paid orders" : formatPesos(p.averageOrder)}
        />
        <Stat
          title="Last order"
          value={p.lastOrder ? formatDate(p.lastOrder) : "No orders yet"}
          note={p.lastOrder ? formatAgo(p.lastOrder, now) : undefined}
        />
        <Stat
          title="Feedback given"
          value={p.averageRating === null ? "No feedback" : `${p.averageRating.toFixed(1)} / 5`}
          note={`${p.feedbackCount} ${p.feedbackCount === 1 ? "review" : "reviews"}`}
        />
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="orders">Orders</TabsTrigger>
          <TabsTrigger value="cart">Cart</TabsTrigger>
          <TabsTrigger value="feedback">Feedback</TabsTrigger>
          <TabsTrigger value="emails">Emails</TabsTrigger>
          <TabsTrigger value="details">Details</TabsTrigger>
        </TabsList>

        <TabsContent value="cart">
          <CartTab cart={p.cart} />
        </TabsContent>

        <TabsContent value="feedback">
          <FeedbackTab orders={p.orderHistory} onOpenOrder={openOrder} />
        </TabsContent>

        <TabsContent value="emails">
          <EmailsTab marketingOptIn={p.marketingOptIn} />
        </TabsContent>

        <TabsContent value="orders">
          <OrdersTab orders={p.orderHistory} />
        </TabsContent>

        <TabsContent value="details" className="space-y-md">
          <dl className="grid gap-md sm:grid-cols-2 lg:grid-cols-3">
            <Field label="First name">{p.firstName}</Field>
            <Field label="Middle name">{p.middleName ?? "—"}</Field>
            <Field label="Last name">{p.lastName}</Field>
            <Field label="Email">{p.email}</Field>
            <Field label="Contact number">{p.contactNumber}</Field>
            <Field label="Marketing emails">{p.marketingOptIn ? "Opted in" : "Not opted in"}</Field>
            <Field label="Customer since">{formatDate(p.customerSince)}</Field>
          </dl>

          <section className="space-y-sm">
            <h2 className="text-title-lg text-foreground">Addresses</h2>
            {p.addresses.length === 0 ? (
              <p className="text-muted-foreground">No addresses saved.</p>
            ) : (
              <ul className="grid gap-md sm:grid-cols-2">
                {p.addresses.map((a) => (
                  <li key={a.id}>
                    <Card>
                      <CardContent className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{a.label}</span>
                          {a.isDefault && (
                            <Badge>
                              <Star className="size-3" /> Default address
                            </Badge>
                          )}
                        </div>
                        <p className="text-body-md text-foreground">
                          {a.street}, {a.barangay}, {a.city}, {a.province} {a.postalCode},{" "}
                          {a.country}
                        </p>
                      </CardContent>
                    </Card>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </TabsContent>
      </Tabs>
    </div>
  );
}
