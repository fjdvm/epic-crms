# Exports

All exported documents use `lib/export/pdf-template.ts`.

- `createBrandedPdf({ title, subtitle?, now })` returns `{ doc, width, room, line, heading, table, finish }`. It draws the logo, "Bren Raphael's", "Ube Jam & Halaya" and the title in the header, and a footer with the Philippine generation time and "Page n of m" on every page. Draw the body, then `await finish()` for the bytes.
- `pdfResponse(buffer, filename, { inline })` sets the PDF headers (`inline` opens in the viewer, otherwise it downloads; always `private, no-store`).
- `BRAND` holds the colours; the logo is `public/images/brand/logo-ube-jam-halaya.jpeg` and the font is `lib/export/assets/DejaVuSans.ttf`.

Current exports: the Dashboard PDF (`features/dashboard/pdf.ts`, `/api/dashboard/pdf`) and the Order packing slip (`features/orders/packing-slip-pdf.ts`, `/api/orders/[id]/packing-slip`). The slip route reuses `loadPackingSlip`, which checks the Fulfilment Module and leaves out payment evidence.
