import { Star } from "lucide-react";

import { Badge } from "@/components/ui/badge";

import { Field } from "./field";
import { formatDate } from "./format";
import { TabCard } from "./tab-card";
import type { WalkInProfileData } from "./walk-ins";

/** The Details tab of a Walk-in Customer: everything Staff entered when adding them. */
export function WalkInDetails({ walkIn: w }: { walkIn: WalkInProfileData }) {
  const a = w.address;

  return (
    <>
      <TabCard title="Details">
        <dl className="grid gap-md sm:grid-cols-2 lg:grid-cols-3">
          <Field label="First name">{w.firstName}</Field>
          <Field label="Last name">{w.lastName}</Field>
          <Field label="Mobile number">{w.mobile}</Field>
          <Field label="Email">{w.email ?? "—"}</Field>
          <Field label="Birthday">{w.birthday ? formatDate(new Date(`${w.birthday}T00:00:00Z`)) : "—"}</Field>
          <Field label="Preferred contact">{w.preferredContact ?? "—"}</Field>
          <Field label="Source">{w.source ?? "—"}</Field>
          <Field label="Added">{formatDate(w.createdAt)}</Field>
          <Field label="Tags">
            {w.tags.length === 0 ? (
              "—"
            ) : (
              <span className="flex flex-wrap gap-1.5">
                {w.tags.map((tag) => (
                  <Badge key={tag} variant="purple">{tag}</Badge>
                ))}
              </span>
            )}
          </Field>
          <Field label="Email newsletter">{w.emailConsent ? "Opted in" : "Not opted in"}</Field>
          <Field label="SMS promos">{w.smsConsent ? "Opted in" : "Not opted in"}</Field>
        </dl>
      </TabCard>

      <TabCard title="Internal notes" note="Visible to Staff only">
        <p className="whitespace-pre-wrap text-sm text-foreground">{w.notes ?? "No notes."}</p>
      </TabCard>

      <TabCard title="Addresses">
        {a ? (
          <ul className="grid gap-md sm:grid-cols-2">
            <li className="space-y-1 rounded-lg bg-secondary p-md">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">Default delivery address</span>
                <Badge variant="purple">
                  <Star className="mr-1 size-3" /> Default address
                </Badge>
              </div>
              <p className="text-sm text-foreground">
                {[a.street, a.barangay, a.city, a.province, a.zip].filter(Boolean).join(", ")}
              </p>
              {a.landmark && <p className="text-sm text-muted-foreground">Landmark: {a.landmark}</p>}
            </li>
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No addresses saved.</p>
        )}
      </TabCard>
    </>
  );
}
