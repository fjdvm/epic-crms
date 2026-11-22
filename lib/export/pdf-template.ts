import path from "node:path";

import PDFDocument from "pdfkit";
import sharp from "sharp";

/** Brand tokens for every exported document (the same purple as the app's `--primary`). */
export const BRAND = {
  name: "Bren Raphael's",
  line: "Ube Jam & Halaya",
  purple: "#5b2a86",
  ink: "#18181b",
  muted: "#71717a",
  rule: "#e6e1ee",
  tint: "#eee8f3",
} as const;

const MARGIN = 44;
const HEADER_BOTTOM = 112;

export const manilaDate = new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium" });
export const manilaTimestamp = new Intl.DateTimeFormat("en-PH", {
  timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short", hour12: false,
});

export type BrandedPdf = {
  doc: PDFKit.PDFDocument;
  /** Usable width between the margins. */
  width: number;
  /** Starts a new page when fewer than `height` points remain above the footer. */
  room: (height: number) => void;
  /** Writes one wrapped line of body text at the left margin. */
  line: (text: string, muted?: boolean) => void;
  /** Writes a purple section title. */
  heading: (text: string) => void;
  /** Draws a table with a header row; `widths` are fractions of the usable width and `right` marks right-aligned columns. */
  table: (head: string[], rows: string[][], options: { widths: number[]; right?: number[] }) => void;
  /** Adds the footer to every page, ends the document and returns the PDF bytes. */
  finish: () => Promise<Buffer>;
};

/**
 * The one template every exported document starts from: A4, the Bren Raphael's Ube Jam & Halaya logo and
 * name, a title block, and a footer with the Philippine generation time and page numbers. Exports draw
 * their body between the header and the footer and must not re-draw their own branding.
 */
export async function createBrandedPdf(
  { title, subtitle, now }: { title: string; subtitle?: string; now: Date },
): Promise<BrandedPdf> {
  const logo = await sharp(path.join(process.cwd(), "public/images/brand/logo-ube-jam-halaya.jpeg"))
    .resize(240, 240, { fit: "contain", background: "#ffffff" }).png().toBuffer();
  const doc = new PDFDocument({
    size: "A4", margin: MARGIN, bufferPages: true,
    font: path.join(process.cwd(), "lib/export/assets/DejaVuSans.ttf"),
    info: { Title: `${BRAND.name} ${BRAND.line} - ${title}`, Author: `${BRAND.name} ${BRAND.line}`, CreationDate: now },
  });
  const chunks: Buffer[] = [];
  const completed = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
  const width = doc.page.width - MARGIN * 2;
  const bottom = () => doc.page.height - 56;

  const drawHeader = () => {
    doc.image(logo, MARGIN, 34, { width: 60 });
    doc.fillColor(BRAND.purple).fontSize(17).text(BRAND.name, MARGIN + 72, 44, { lineBreak: false });
    doc.fillColor(BRAND.muted).fontSize(8).text(BRAND.line.toUpperCase(), MARGIN + 72, 68, { characterSpacing: 1.6, lineBreak: false });
    doc.fillColor(BRAND.purple).fontSize(18).text(title, MARGIN, 44, { width, align: "right", lineBreak: false });
    if (subtitle) doc.fillColor(BRAND.muted).fontSize(10).text(subtitle, MARGIN, 68, { width, align: "right", lineBreak: false });
    doc.moveTo(MARGIN, 100).lineTo(MARGIN + width, 100).lineWidth(1).strokeColor(BRAND.rule).stroke();
    doc.x = MARGIN;
    doc.y = HEADER_BOTTOM;
  };
  drawHeader();
  doc.on("pageAdded", drawHeader);

  const room = (height: number) => {
    if (doc.y + height > bottom()) doc.addPage();
  };
  const line = (text: string, muted = false) => {
    doc.fontSize(10);
    room(doc.heightOfString(text, { width }) + 8);
    doc.fillColor(muted ? BRAND.muted : BRAND.ink).text(text, MARGIN, doc.y, { width });
    doc.moveDown(0.35);
  };
  const heading = (text: string) => {
    room(60);
    doc.moveDown(0.6);
    doc.fillColor(BRAND.purple).fontSize(13).text(text, MARGIN, doc.y, { width });
    doc.moveDown(0.35);
  };
  const table: BrandedPdf["table"] = (head, rows, { widths, right = [] }) => {
    const gap = 6;
    const columns = widths.map((fraction) => fraction * width);
    const draw = (cells: string[], bold: boolean) => {
      doc.fontSize(bold ? 9 : 10);
      const height = Math.max(...cells.map((cell, i) => doc.heightOfString(cell, { width: columns[i] - gap })));
      if (doc.y + height + 10 > bottom()) { doc.addPage(); drawHead(); }
      const y = doc.y;
      let x = MARGIN;
      cells.forEach((cell, i) => {
        doc.fillColor(bold ? BRAND.muted : BRAND.ink).text(cell, x, y, { width: columns[i] - gap, align: right.includes(i) ? "right" : "left" });
        x += columns[i];
      });
      const lineY = y + height + 4;
      doc.moveTo(MARGIN, lineY).lineTo(MARGIN + width, lineY).lineWidth(0.5).strokeColor(bold ? BRAND.purple : BRAND.rule).stroke();
      doc.x = MARGIN;
      doc.y = lineY + 6;
    };
    const drawHead = () => draw(head, true);
    drawHead();
    for (const row of rows) draw(row, false);
  };

  const finish = () => {
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(range.start + i);
      // Writing below the bottom margin would add a page, so lift it for the footer only.
      const margin = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;
      const y = doc.page.height - 38;
      doc.moveTo(MARGIN, y - 8).lineTo(MARGIN + width, y - 8).lineWidth(0.5).strokeColor(BRAND.rule).stroke();
      doc.fillColor(BRAND.muted).fontSize(8)
        .text(`${BRAND.name} ${BRAND.line} · Generated ${manilaTimestamp.format(now)} Philippine Time`, MARGIN, y, { width: width - 80, lineBreak: false })
        .text(`Page ${i + 1} of ${range.count}`, MARGIN + width - 80, y, { width: 80, align: "right", lineBreak: false });
      doc.page.margins.bottom = margin;
    }
    doc.end();
    return completed;
  };

  return { doc, width, room, line, heading, table, finish };
}

/** A PDF response; `inline` opens it in the browser's viewer (where it can be printed), otherwise it downloads. */
export function pdfResponse(pdf: Buffer, filename: string, { inline = false }: { inline?: boolean } = {}) {
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
