"use client";

import type { ShopRole } from "@/lib/portal/roles";

import { OrderActionDialog } from "./action-dialog";
import { resendStatusEmail } from "./actions";
import { emailTitle, STATUS_EMAILS, type FailedEmail } from "./status-emails";

/**
 * Shown for each Status email that failed after retries, to anyone holding that email's owning Module. Staff and
 * Managers can resend it; Admin only read it. A Resend reaches a Customer, so it waits for the server
 * (spinner within 100 ms) and is never optimistic.
 */
export function EmailNotSent({ orderId, failures, modules, role }: { orderId: number; failures: readonly FailedEmail[]; modules?: readonly string[]; role?: ShopRole | null }) {
  const visible = failures.filter((failure) => !modules || modules.includes(STATUS_EMAILS[failure.kind].module));
  if (visible.length === 0) return null;
  const canResend = role === undefined || role === "staff" || role === "manager";
  return (
    <div data-testid="email-not-sent" role="alert" className="space-y-2">
      {visible.map((failure) => {
        const label = STATUS_EMAILS[failure.kind].label;
        return (
          <section key={`${failure.kind}:${failure.occurrence ?? ""}`} className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-[#fdf1d8] p-4 text-sm text-[#8a5a00]">
            <div className="space-y-0.5">
              <p className="font-medium">Email not sent</p>
              <p className="text-xs">The {label} email could not be sent: {failure.reason}</p>
            </div>
            {canResend && (
              <OrderActionDialog
                trigger={`Resend ${label} email`}
                title={`Resend the ${label} email for Order #${orderId}?`}
                description="The Customer gets this email again, once. The resend is recorded with your name."
                confirm="Resend email" busy="Sending…"
                run={() => resendStatusEmail(orderId, failure.kind, failure.occurrence)}
                successMessage={`${emailTitle(failure.kind)} sent.`}
              />
            )}
          </section>
        );
      })}
    </div>
  );
}
