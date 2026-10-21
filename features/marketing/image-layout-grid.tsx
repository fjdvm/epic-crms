import { bandsOf, type Bands, type ImageLayout } from "./image-layouts";

/** An email's content width in px; the layouts' tile heights are drawn against it. */
const CONTENT_WIDTH = 552;
const EMAIL_GAP = 8;

type Tile = { height: number; index: number };

/** Each tile with its place in the reading order, which is the order the images fill them. */
function numbered(bands: Bands): Tile[][][] {
  let index = 0;

  return bands.map((band) => band.map((heights) => heights.map((height) => ({ height, index: index++ }))));
}

const bandHeight = (band: Tile[][]) =>
  Math.max(...band.map((tiles) => tiles.reduce((sum, t) => sum + t.height, 0) + EMAIL_GAP * (tiles.length - 1)));

/** A picture at its own proportions, or a placeholder when only the layout is being pictured. */
function Picture({ src, placeholder }: { src?: string; placeholder: string }) {
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" className="block h-auto w-full rounded-[6px]" />
  ) : (
    <div className={`w-full rounded-[3px] bg-[#d9cdea] ${placeholder}`} />
  );
}

/**
 * The images of an Announcement arranged in a layout, as the email draws them. With `images` it shows
 * them; without, it draws placeholder tiles, which is how a layout is pictured in the picker.
 */
export function ImageLayoutGrid({
  layout,
  images,
  gap = 6,
}: {
  layout: ImageLayout;
  images?: string[];
  /** Space between tiles, in px. */
  gap?: number;
}) {
  const bands = bandsOf(layout);

  if (!bands) {
    // Stacked has no fixed tiles: one per image, or three to picture it.
    const sources = images ?? [undefined, undefined, undefined];

    return (
      <div data-layout={layout} className="flex flex-col" style={{ gap }}>
        {sources.map((src, i) => (
          <Picture key={i} src={src} placeholder="h-3" />
        ))}
      </div>
    );
  }

  return (
    <div data-layout={layout} className="flex flex-col" style={{ gap }}>
      {numbered(bands).map((band, b) => {
        // A height of 0 keeps the picture's own proportions, so the band has no fixed shape.
        const natural = band.flat(2).some((t) => t.height === 0);

        return (
          <div key={b} className="flex" style={{ gap, aspectRatio: natural ? undefined : `${CONTENT_WIDTH} / ${bandHeight(band)}` }}>
            {band.map((tiles, c) => (
              <div key={c} className="flex min-w-0 flex-1 flex-col" style={{ gap }}>
                {tiles.map(({ height, index }) =>
                  natural ? (
                    <Picture key={index} src={images?.[index]} placeholder="h-10" />
                  ) : (
                    <div key={index} className="min-h-0" style={{ flex: height }}>
                      {images?.[index] ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={images[index]} alt="" className="block size-full rounded-[6px] object-cover" />
                      ) : (
                        <div className="size-full rounded-[3px] bg-[#d9cdea]" />
                      )}
                    </div>
                  ),
                )}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
