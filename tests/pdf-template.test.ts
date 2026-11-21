import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

import { createBrandedPdf } from "@/lib/export/pdf-template";

describe("Branded PDF template", () => {
  it("ships the logo and font it draws", () => {
    expect(existsSync(path.join(process.cwd(), "public/images/brand/logo-ube-jam-halaya.jpeg"))).toBe(true);
    expect(existsSync(path.join(process.cwd(), "lib/export/assets/DejaVuSans.ttf"))).toBe(true);
  });

  it("brands every page and numbers the footer", async () => {
    const pdf = await createBrandedPdf({ title: "Test export", now: new Date("2026-10-24T17:30:00Z") });
    for (let i = 0; i < 90; i++) pdf.line(`Line ${i}`);
    const data = new Uint8Array(await pdf.finish());
    const doc = await getDocument({ data, useSystemFonts: true }).promise;
    expect(doc.numPages).toBeGreaterThan(1);
    for (let n = 1; n <= doc.numPages; n++) {
      const text = (await (await doc.getPage(n)).getTextContent()).items.map((item) => "str" in item ? item.str : "").join(" ");
      expect(text).toContain("Bren Raphael's");
      expect(text).toContain("Test export");
      expect(text).toContain("Generated Oct 25, 2026, 01:30");
      expect(text).toContain(`Page ${n} of ${doc.numPages}`);
    }
  });
});
