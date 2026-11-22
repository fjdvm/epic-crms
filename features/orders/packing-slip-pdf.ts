import { createBrandedPdf, BRAND, manilaDate } from "@/lib/export/pdf-template";
import { orderLabel } from "@/features/customer-profiles/rules";

import type { loadPackingSlip } from "./actions";

type Slip = Extract<Awaited<ReturnType<typeof loadPackingSlip>>, { ok: true }>["slip"];

/** The packing slip carries no payment evidence: only what Fulfilment needs to pack and hand over. */
export async function packingSlipPdf(slip: Slip, now: Date = new Date()): Promise<Buffer> {
  const pdf = await createBrandedPdf({ title: "Packing slip", subtitle: `Order #${slip.id}`, now });
  const { doc, line, heading, table } = pdf;
  const { address } = slip;

  line(`Placed ${manilaDate.format(slip.createdAt)}`, true);
  heading("Customer");
  line(slip.customer.name);
  heading(orderLabel(slip.fulfillmentMethod));
  if (address) line(`${address.street}, ${address.barangay}, ${address.city}, ${address.province} ${address.postalCode}, ${address.country}`);

  heading("Items");
  table(
    ["Item", "Size", "Qty", "Packed"],
    [...slip.lines.map((item) => [item.product, item.size, String(item.quantity), "☐"]),
      ["Total items", "", String(slip.lines.reduce((sum, item) => sum + item.quantity, 0)), ""]],
    { widths: [0.55, 0.2, 0.12, 0.13], right: [2] },
  );

  doc.moveDown(0.8);
  doc.fillColor(BRAND.ink).fontSize(10);
  line(slip.packedBy ? `Packed by ${slip.packedBy.name} · ${manilaDate.format(slip.packedBy.at)}` : "Packed by: ____________________   Date: ____________");
  return pdf.finish();
}
