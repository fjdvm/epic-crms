import { validateSession } from "@/lib/portal/client";
import { shopRole } from "@/lib/portal/roles";
import { crmsDatabase } from "@/lib/crms-db";
import { changeCodAmount } from "@/features/orders/cod-settings";
import { codAmountSetting } from "@/features/orders/cod-flags";

/** Portal Settings uses a short-lived, centrally validated CREOMS handle, never a browser actor. `{}` reads; `{amountInCentavos}` changes (Admin only). */
export async function POST(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  const handle = request.headers.get("authorization")?.match(/^Bearer (\S+)$/)?.[1];
  if (!handle) return Response.json({ error: "Sign in first." }, { status: 401, headers });
  const access = await validateSession(handle, "Portal Settings");
  if (access.decision !== "allowed") return Response.json({ error: "Portal Settings access could not be confirmed." }, { status: access.decision === "unavailable" ? 503 : 403, headers });
  if (!["admin", "ceo", "manager"].includes(shopRole(access.staff.role) ?? "")) return Response.json({ error: "Your Role cannot open these Settings." }, { status: 403, headers });
  try {
    const input = await request.json();
    if (Object.hasOwn(input, "amountInCentavos")) {
      const result = await changeCodAmount(access.staff, input.amountInCentavos);
      return Response.json(result, { status: result.ok ? 200 : 403, headers });
    }
    return Response.json({ ok: true, amountInCentavos: await codAmountSetting(crmsDatabase()) }, { headers });
  } catch { return Response.json({ error: "Cash on Delivery settings are temporarily unavailable." }, { status: 503, headers }); }
}
