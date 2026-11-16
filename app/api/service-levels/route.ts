import { validateSession } from "@/lib/portal/client";
import { shopRole } from "@/lib/portal/roles";
import { crmsDatabase } from "@/lib/crms-db";
import { gatewayAuditTrail } from "@/lib/gateway";
import { currentTargets, setServiceTargets } from "@/features/tickets/service-level-store";

/**
 * Portal Settings, Service levels. As the Approval limit: a short-lived, centrally validated handle,
 * never a browser actor. `{}` reads the pair in force; `{firstReplyHours, resolveHours}` changes it
 * (Admin only). Manager and CEO may read; Staff are refused.
 */
export async function POST(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  const handle = request.headers.get("authorization")?.match(/^Bearer (\S+)$/)?.[1];
  if (!handle) return Response.json({ error: "Sign in first." }, { status: 401, headers });
  const access = await validateSession(handle, "Portal Settings");
  if (access.decision !== "allowed")
    return Response.json({ error: "Portal Settings access could not be confirmed." }, { status: access.decision === "unavailable" ? 503 : 403, headers });
  const role = shopRole(access.staff.role);
  if (!["admin", "ceo", "manager"].includes(role ?? ""))
    return Response.json({ error: "Your Role cannot open these Settings." }, { status: 403, headers });
  try {
    const input = await request.json();
    if (Object.hasOwn(input, "firstReplyHours") || Object.hasOwn(input, "resolveHours")) {
      const result = await setServiceTargets(crmsDatabase(), gatewayAuditTrail, access.staff, input);
      return Response.json(result, { status: result.ok ? 200 : result.reason.startsWith("Only") ? 403 : 400, headers });
    }
    return Response.json({ ok: true, ...(await currentTargets(crmsDatabase())) }, { headers });
  } catch {
    return Response.json({ error: "Service levels are temporarily unavailable." }, { status: 503, headers });
  }
}
