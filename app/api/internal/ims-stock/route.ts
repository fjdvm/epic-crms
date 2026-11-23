import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { applyImsFigures } from "@/features/orders/stock-count";
import { crmsDatabase } from "@/lib/crms-db";
import { verifyImsStockCredential } from "@/lib/ims-credential";

export const dynamic = "force-dynamic";

const count = z.number().int().min(0).max(2_147_483_647).nullable();
const push = z.object({
  productId: z.number().int().min(1).max(2_147_483_647),
  name: z.string().trim().max(500),
  variant: z.string().trim().max(200).nullable(),
  image: z.string().max(2_000).nullable(),
  price: z.number().finite().nullable(),
  active: z.boolean(),
  quantity: count,
  reserved: count,
  available: count,
  version: z.string().regex(/^\d{1,19}$/),
});

/**
 * The IMS pushes one Size's shop figures here on every change. This is the only way CREOMS's stock count changes:
 * no CREOMS user can edit it. An older push than CREOMS holds is accepted and ignored.
 */
export async function POST(request: NextRequest) {
  if (!verifyImsStockCredential(request.headers.get("authorization"))) return new NextResponse(null, { status: 401 });
  const parsed = push.safeParse(await request.json().catch(() => undefined));
  if (!parsed.success) return NextResponse.json({ error: "invalid stock figures" }, { status: 400 });
  const { version, price, variant, ...figures } = parsed.data;
  try {
    const applied = await applyImsFigures(crmsDatabase(), {
      ...figures, variant: variant || null, price: price !== null && price > 0 ? price : null, version: BigInt(version),
    });
    return NextResponse.json({ applied });
  } catch (error) {
    console.error("The IMS stock figures could not be saved", error);
    return NextResponse.json({ error: "stock count unavailable" }, { status: 503 });
  }
}
