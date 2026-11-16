import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { fingerprintImage, fingerprintsSimilar, isFingerprint } from "@/features/returns/image-fingerprint";

const SIZE = 400;
/** A deterministic photo-like picture: smooth gradients plus seeded shapes. */
async function picture(seed: number) {
  let state = seed;
  const next = () => (state = (state * 1664525 + 1013904223) % 4294967296) / 4294967296;
  const shapes = Array.from({ length: 12 }, () =>
    `<circle cx="${next() * SIZE}" cy="${next() * SIZE}" r="${20 + next() * 70}" fill="rgb(${Math.floor(next() * 255)},${Math.floor(next() * 255)},${Math.floor(next() * 255)})"/>`).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}"><rect width="100%" height="100%" fill="rgb(${seed % 255},120,90)"/>${shapes}</svg>`;

  return sharp(Buffer.from(svg)).png().toBuffer();
}

describe("image fingerprint", () => {
  it("has a fixed shape", async () => {
    expect(isFingerprint(await fingerprintImage(await picture(1)))).toBe(true);
  });

  it("matches a re-saved, resized copy", async () => {
    const original = await picture(1);
    const resaved = await sharp(original).resize(250).jpeg({ quality: 55 }).toBuffer();
    expect(fingerprintsSimilar(await fingerprintImage(original), await fingerprintImage(resaved))).toBe(true);
  });

  it("matches a cropped copy", async () => {
    const original = await picture(1);
    const cropped = await sharp(original).extract({ left: 20, top: 20, width: 340, height: 340 }).jpeg().toBuffer();
    expect(fingerprintsSimilar(await fingerprintImage(original), await fingerprintImage(cropped))).toBe(true);
  });

  it("does not match unrelated photos", async () => {
    const original = await fingerprintImage(await picture(1));
    for (const seed of [2, 3, 4, 5, 6, 7]) {
      expect(fingerprintsSimilar(original, await fingerprintImage(await picture(seed)))).toBe(false);
    }
  });
});
