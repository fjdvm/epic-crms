import sharp, { type Sharp } from "sharp";

/**
 * A similar-image fingerprint, computed on our side from the photo's own bytes. No model or outside
 * service sees the photo. It is two 64-bit difference hashes joined as "<whole>:<centre>", each 16 hex
 * characters: one of the whole picture and one of its middle 80%, so a cropped copy still lines up with
 * the original and a re-saved or resized copy barely moves.
 */
export type Fingerprint = string;

/** Most differing bits (out of 64) for two hashes to count as the same picture. */
export const SIMILAR_MAX_DISTANCE = 10;

const FINGERPRINT = /^[0-9a-f]{16}:[0-9a-f]{16}$/;
export const isFingerprint = (value: unknown): value is Fingerprint => typeof value === "string" && FINGERPRINT.test(value);

async function differenceHash(image: Sharp): Promise<string> {
  // Nine columns by eight rows; each bit says whether a pixel is brighter than its right neighbour.
  const { data } = await image.clone().greyscale().resize(9, 8, { fit: "fill", kernel: "cubic" }).raw()
    .toBuffer({ resolveWithObject: true });
  let bits = "";
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) bits += data[row * 9 + col] > data[row * 9 + col + 1] ? "1" : "0";
  }

  return [0, 1, 2, 3, 4, 5, 6, 7].map(i => parseInt(bits.slice(i * 8, i * 8 + 8), 2).toString(16).padStart(2, "0")).join("");
}

export async function fingerprintImage(bytes: Buffer | Uint8Array): Promise<Fingerprint> {
  const upright = sharp(bytes, { failOn: "none" }).rotate();
  const { data, info } = await upright.clone().raw().toBuffer({ resolveWithObject: true });
  const whole = sharp(data, { raw: info });
  const marginX = Math.floor(info.width * 0.1);
  const marginY = Math.floor(info.height * 0.1);
  const centre = whole.clone().extract({
    left: marginX, top: marginY,
    width: Math.max(1, info.width - 2 * marginX), height: Math.max(1, info.height - 2 * marginY),
  });

  return `${await differenceHash(whole)}:${await differenceHash(centre)}`;
}

function bitDistance(a: string, b: string): number {
  let count = 0;
  for (let i = 0; i < 16; i++) {
    let diff = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    while (diff) { count += diff & 1; diff >>= 1; }
  }

  return count;
}

/** Two photos are similar when any pairing of whole and centre hashes is within the distance. */
export function fingerprintsSimilar(a: Fingerprint, b: Fingerprint): boolean {
  const [aWhole, aCentre] = a.split(":");
  const [bWhole, bCentre] = b.split(":");

  return [[aWhole, bWhole], [aWhole, bCentre], [aCentre, bWhole], [aCentre, bCentre]]
    .some(([x, y]) => bitDistance(x, y) <= SIMILAR_MAX_DISTANCE);
}
