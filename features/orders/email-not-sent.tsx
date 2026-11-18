"use client";

import type { ShopRole } from "@/lib/portal/roles";

import { OrderActionDialog } from "./action-dialog";
import { resendConfirmationEmail } from "./actions";

/**
 * Shown only while the confirmation email has failed after retries. Staff and Managers can resend it; Admin and
 * the CEO only read it. The resend reaches a Customer, so it waits for the server and is never optimistic.
 */
export function EmailNotSent({ orderId, reason, role }: { orderId: number; reason: string; role?: ShopRole | null }) {
  const canResend = role === undefined || role === "staff" || role === "manager";
  return (
    <section data-testid="email-not-sent" role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-[#fdf1d8] p-4 text-sm text-[#8a5a00]">
      <div className="space-y-0.5">
        <p className="font-medium">Email not sent</p>
        <p className="text-xs">The confirmation email could not be sent: {reason}</p>
      </div>
      {canResend && (
        <OrderActionDialog
          trigger="Resend confirmation email"
          title={`Resend the confirmation email for Order #${orderId}?`}
          description="The Customer gets the confirmation email again. The resend is recorded with your name."
          confirm="Resend email" busy="Sending…"
          run={() => resendConfirmationEmail(orderId)}
          successMessage="Confirmation email sent."
        />
      )}
    </section>
  );
}
