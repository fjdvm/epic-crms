import { validateSession } from "@/lib/portal/client";
import { RETURNS_MODULE } from "@/lib/portal/config";
import { shopRole } from "@/lib/portal/roles";
import { approvals } from "@/features/approvals/server";
import { crmsDatabase } from "@/lib/crms-db";

/** Portal Settings uses a short-lived, centrally validated CREOMS handle, never a browser actor. */
export async function POST(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  const handle = request.headers.get("authorization")?.match(/^Bearer (\S+)$/)?.[1];
  if (!handle) return Response.json({ error: "Sign in first." }, { status: 401, headers });
  const access = await validateSession(handle, RETURNS_MODULE);
  if (access.decision !== "allowed") return Response.json({ error: "Returns access could not be confirmed." }, { status: access.decision === "unavailable" ? 503 : 403, headers });
  const role = shopRole(access.staff.role);
  if (!["admin", "ceo", "manager"].includes(role ?? "")) return Response.json({ error: "Your Role cannot open these Settings." }, { status: 403, headers });
  try {
    const input = await request.json();
    if (Object.hasOwn(input, "amountInCentavos")) {
      const result = await approvals().setLimit(access.staff, input.amountInCentavos);
      return Response.json(result, { status: result.ok ? 200 : 403, headers });
    }
    const [setting] = await crmsDatabase()`select limit_in_centavos from crms.approval_settings where singleton`;
    return Response.json({ ok: true, amountInCentavos: Number(setting.limit_in_centavos) }, { headers });
  } catch { return Response.json({ error: "Approval settings are temporarily unavailable." }, { status: 503, headers }); }
}
