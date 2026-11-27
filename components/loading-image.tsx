"use client";

import { useState, type ComponentProps } from "react";

import { DEFAULT_PRODUCT_IMAGE } from "@/lib/brand-images";
import { cn } from "@/lib/utils";

type Props = ComponentProps<"img"> & { src: string; alt: string; placeholderClassName?: string };

/**
 * A photo that shows the brand logo until it has loaded. A photo that fails drops the logo too, so a
 * failure never looks like it is still loading.
 */
export function LoadingImage({ src, alt, className, placeholderClassName, onLoad, onError, ...props }: Props) {
  const [settled, setSettled] = useState<string | null>(null);
  const loading = settled !== src;

  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed address */}
      <img
        {...props}
        // A cached photo can finish before React listens for it.
        ref={(img) => {
          if (img?.complete) setSettled(src);
        }}
        src={src}
        alt={alt}
        onLoad={(event) => {
          setSettled(src);
          onLoad?.(event);
        }}
        onError={(event) => {
          setSettled(src);
          onError?.(event);
        }}
        // Kept in the page while loading, so it still downloads.
        className={cn(className, loading && "absolute size-px opacity-0")}
      />
      {loading && (
        // eslint-disable-next-line @next/next/no-img-element -- small static placeholder
        <img data-loading-image src={DEFAULT_PRODUCT_IMAGE} alt="" className={cn(className, "object-contain p-1", placeholderClassName)} />
      )}
    </>
  );
}
