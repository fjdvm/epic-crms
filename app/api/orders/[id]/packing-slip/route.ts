import { loadPackingSlip } from "@/features/orders/actions";
import { packingSlipPdf } from "@/features/orders/packing-slip-pdf";
import { pdfResponse } from "@/lib/export/pdf-template";

export const runtime = "nodejs";

/** A read-only PDF; `loadPackingSlip` checks the Fulfilment Module and leaves payment evidence out. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  const result = await loadPackingSlip(id);
  if (!result.ok) {
    const status = result.reason === "Invalid Order number." ? 400 : result.reason === "Order was not found." ? 404 : 503;
    return Response.json({ reason: result.reason }, { status, headers: { "Cache-Control": "private, no-store" } });
  }
  return pdfResponse(await packingSlipPdf(result.slip), `packing-slip-order-${result.slip.id}.pdf`, { inline: true });
}
