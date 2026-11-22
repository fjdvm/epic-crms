import { explainReturnFlag } from "@/features/returns/return-flag-explain";
import { crmsDatabase } from "@/lib/crms-db";
import { RETURNS_MODULE } from "@/lib/portal/config";
import { requireModule } from "@/lib/portal/staff";
import { ticketsDatabase } from "@/lib/tickets-db";

const headers = { "Cache-Control": "private, no-store" };
const STATUS = { forbidden: 403, "not-flagged": 404, unavailable: 502 } as const;

/** "Explain this flag", asked by a Manager on a click. Never a timer; Staff and Admin are refused before any model call. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (request.headers.get("x-creoms-flag-explain") !== "1" || request.headers.get("sec-fetch-site") === "cross-site")
    return Response.json({ ok: false, reason: "forbidden" }, { status: 403, headers });
  const staff = await requireModule(RETURNS_MODULE);
  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!/^\d{1,9}$/.test(id) || !body || (body.rule !== "frequent-returns" && body.rule !== "similar-photo"))
    return Response.json({ ok: false, reason: "not-flagged" }, { status: 400, headers });
  const result = await explainReturnFlag({ reader: ticketsDatabase(), crms: crmsDatabase() }, staff, Number(id), body.rule);
  return Response.json(result, { status: result.ok ? 200 : STATUS[result.reason], headers });
}
