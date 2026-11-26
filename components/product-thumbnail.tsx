"use client";

import { useState } from "react";

import { cn } from "@/lib/utils";
import { ZoomableImage } from "@/components/zoomable-image";

/** Shown for a product with no image, or one whose image fails to load. */
export const DEFAULT_PRODUCT_IMAGE = "/images/brand/default-product.png";

/**
 * A product's image, filling its tile. A click zooms a real image. With no image, or one that fails to load,
 * the brand logo shows instead, scaled to fit the tile whole: never cropped, never zoomable.
 */
export function ProductThumbnail({ src, alt, className }: { src: string | null; alt: string; className?: string }) {
  const [failed, setFailed] = useState<string | null>(null);

  if (src && failed !== src) {
    return <ZoomableImage src={src} alt={alt} onError={() => setFailed(src)} className={cn("size-full object-cover", className)} />;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- small static placeholder
    <img data-default-image src={DEFAULT_PRODUCT_IMAGE} alt="" className={cn("size-full object-contain p-1", className)} />
  );
}
