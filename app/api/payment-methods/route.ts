import { timingSafeEqual } from "node:crypto";

import { crmsDatabase } from "@/lib/crms-db";
import { listMethodAvailability } from "@/features/management/payment-accounts";

export const dynamic = "force-dynamic";

/**
 * Which payment methods the storefront may offer at checkout: GCash, Maya and Bank transfer, each true only when a Manager or the CEO
 * has it on and an account is active. Read-only, booleans only (no account details), called by the storefront's server with the
 * shared service secret. Cash on Delivery is not listed; it has no account.
 */
export async function GET(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  const secret = process.env.CREOMS_SERVICE_SECRET;
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const wanted = Buffer.from(`Bearer ${secret}`);
  if (!secret || secret.length < 32 || given.length !== wanted.length || !timingSafeEqual(given, wanted)) {
    return Response.json({ error: "Not allowed." }, { status: 401, headers });
  }
  try {
    return Response.json({ ok: true, methods: await listMethodAvailability(crmsDatabase()) }, { headers });
  } catch {
    return Response.json({ error: "Payment methods are temporarily unavailable." }, { status: 503, headers });
  }
}
