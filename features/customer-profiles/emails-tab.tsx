"use client";

import { useState } from "react";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { EmailReceived } from "@/features/marketing/announcements";
import { InboxPreview } from "@/features/marketing/inbox-preview";

import { Field } from "./field";
import { formatDate } from "./format";
import { TabCard } from "./tab-card";

/** `emails` is newest first; null when CREOMS could not read them. */
export function EmailsTab({ marketingOptIn, emails }: { marketingOptIn: boolean; emails: EmailReceived[] | null }) {
  const [opened, setOpened] = useState<EmailReceived | null>(null);

  return (
    <TabCard title="Emails">
      <dl>
        <Field label="Marketing emails">{marketingOptIn ? "Opted in" : "Not opted in"}</Field>
      </dl>
      {emails === null ? (
        <div className="p-xl text-center text-muted-foreground">
          The marketing emails this customer received could not be read. Reload to try again.
        </div>
      ) : emails.length === 0 ? (
        <div className="p-xl text-center text-muted-foreground">No marketing emails to show yet.</div>
      ) : (
        <ul className="divide-y divide-border-subtle">
          {emails.map((email) => (
            <li key={email.id} className="py-3 first:pt-0 last:pb-0">
              <button
                type="button"
                onClick={() => setOpened(email)}
                className="flex w-full items-center justify-between gap-2 text-left"
              >
                <span className="min-w-0 truncate text-sm font-medium text-primary hover:underline">{email.title}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{formatDate(email.receivedAt)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={opened !== null} onOpenChange={(open) => !open && setOpened(null)}>
        <DialogContent className="max-h-[90vh] max-w-[420px] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Email received</DialogTitle>
            <DialogDescription>{opened && `Sent ${formatDate(opened.receivedAt)}.`}</DialogDescription>
          </DialogHeader>
          {opened && (
            <InboxPreview title={opened.title} description={opened.description} images={opened.images} imageLayout={opened.imageLayout} />
          )}
        </DialogContent>
      </Dialog>
    </TabCard>
  );
}
