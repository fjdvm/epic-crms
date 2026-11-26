import { NextResponse, type NextRequest } from "next/server";

import { manilaDays } from "@/features/dashboard/period";
import { posSalesIn } from "@/features/pos-sales/sales";
import { database } from "@/lib/db";
import { verifyPosSalesCredential } from "@/lib/pos-credential";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * The POS reads CREOMS's online Sales here: `from` and `to` are Philippine dates, both included. Read-only; money is in
 * centavos. Docs: docs/pos-sales-feed.md.
 */
export async function GET(request: NextRequest) {
  if (!verifyPosSalesCredential(request.headers.get("authorization"))) return new NextResponse(null, { status: 401, headers: NO_STORE });
  const from = request.nextUrl.searchParams.get("from") ?? "";
  const to = request.nextUrl.searchParams.get("to") ?? "";
  const span = manilaDays(from, to);
  if (!span) {
    return NextResponse.json({ error: "from and to must be YYYY-MM-DD Philippine dates, from on or before to, at most 366 days" },
      { status: 400, headers: NO_STORE });
  }
  try {
    const sales = await posSalesIn(database(), span);
    return NextResponse.json({ from, to, timeZone: "Asia/Manila", currency: "PHP", ...sales }, { headers: NO_STORE });
  } catch (error) {
    console.error("The online sales for the POS could not be read", error);
    return NextResponse.json({ error: "sales unavailable" }, { status: 503, headers: NO_STORE });
  }
}
