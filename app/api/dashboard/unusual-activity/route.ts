import { loadUnusualActivity, dismissUnusualActivity, UNUSUAL_ACTIVITY_MODULES } from "@/features/dashboard/unusual-activity";
import { keptExplanations } from "@/features/dashboard/unusual-activity-explain";
import { database } from "@/lib/db";
import { crmsDatabase } from "@/lib/crms-db";
import { DASHBOARD_MODULE } from "@/lib/portal/config";
import { heldModules, requireModule } from "@/lib/portal/staff";

const headers = { "Cache-Control": "private, no-store" };

/** Dashboard opens and data-change/reconnect events may request this. No scheduled work. */
export async function GET() {
  const staff = await requireModule(DASHBOARD_MODULE);
  const modules = await heldModules(UNUSUAL_ACTIVITY_MODULES);
  try {
    const crms = crmsDatabase();
    const activity = await loadUnusualActivity({ source: database(), crms }, staff, modules);
    // Kept explanations only: reading never calls a model. A failure leaves the cards without them.
    const kept = await keptExplanations(crms, activity.cards).catch(() => new Map());
    return Response.json({ ...activity, cards: activity.cards.map(c => kept.has(c.key) ? { ...c, explanation: kept.get(c.key) } : c) }, { headers });
  } catch {
    return Response.json({ cards: [], unavailable: modules }, { status: 503, headers });
  }
}

export async function POST(request: Request) {
  if (request.headers.get("x-creoms-alert-dismiss") !== "1" || request.headers.get("sec-fetch-site") === "cross-site")
    return Response.json({ ok: false, reason: "Forbidden request." }, { status: 403, headers });
  const staff = await requireModule(DASHBOARD_MODULE);
  const modules = await heldModules(UNUSUAL_ACTIVITY_MODULES);
  const body = await request.json().catch(() => null);
  if (!body || typeof body.key !== "string" || body.key.length > 1000 || !body.numbers ||
    Array.isArray(body.numbers) || typeof body.numbers !== "object" ||
    Object.keys(body.numbers).length > 10 || Object.values(body.numbers).some(n => typeof n !== "number" || !Number.isSafeInteger(n) || n < 0))
    return Response.json({ ok: false, reason: "Invalid Unusual activity card." }, { status: 400, headers });
  try {
    const result = await dismissUnusualActivity({ source: database(), crms: crmsDatabase() }, staff, modules, body.key, body.numbers);
    return Response.json(result, { status: result.ok ? 200 : 409, headers });
  } catch {
    return Response.json({ ok: false, reason: "Could not dismiss this Unusual activity card. Please try again." }, { status: 503, headers });
  }
}
