import { validateSession } from "@/lib/portal/client";
import { shopRole } from "@/lib/portal/roles";
import { crmsDatabase } from "@/lib/crms-db";
import { gatewayAuditTrail } from "@/lib/gateway";
import { loadAutomaticChecks, saveAutomaticChecks } from "@/features/settings/automatic-checks";

/**
 * Portal Settings, Automatic checks. Same short-lived Portal handle as the Approval limit.
 * `GET` reads (Admin, CEO, Manager); `PUT` saves the whole set (Admin only). Staff are refused both.
 */
async function authorise(request: Request): Promise<Response | { staff: { id: string; name: string; role: string }; headers: Record<string, string> }> {
  const headers = { "Cache-Control": "no-store" };
  const handle = request.headers.get("authorization")?.match(/^Bearer (\S+)$/)?.[1];
  if (!handle) return (Response.json({ error: "Sign in first." }, { status: 401, headers }));
  const access = await validateSession(handle, "Portal Settings");
  if (access.decision !== "allowed")
    return (Response.json({ error: "Portal Settings access could not be confirmed." }, { status: access.decision === "unavailable" ? 503 : 403, headers }));
  const role = shopRole(access.staff.role);
  if (!["admin", "ceo", "manager"].includes(role ?? ""))
    return (Response.json({ error: "Your Role cannot open these Settings." }, { status: 403, headers }));
  return { staff: access.staff, headers };
}

export async function GET(request: Request) {
  const auth = await authorise(request);
  if (auth instanceof Response) return auth;
  try {
    return Response.json({ ok: true, checks: await loadAutomaticChecks(crmsDatabase()) }, { headers: auth.headers });
  } catch {
    return Response.json({ error: "Automatic checks are temporarily unavailable." }, { status: 503, headers: auth.headers });
  }
}

export async function PUT(request: Request) {
  const auth = await authorise(request);
  if (auth instanceof Response) return auth;
  try {
    const result = await saveAutomaticChecks(crmsDatabase(), gatewayAuditTrail, auth.staff, await request.json());
    return Response.json(result, { status: result.ok ? 200 : result.reason.startsWith("Only") ? 403 : 400, headers: auth.headers });
  } catch {
    return Response.json({ error: "Automatic checks are temporarily unavailable." }, { status: 503, headers: auth.headers });
  }
}
