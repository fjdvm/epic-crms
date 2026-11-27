"use client";

import { useState } from "react";

import { ImageViewer } from "@/components/image-viewer";
import { LoadingImage } from "@/components/loading-image";

/** A photo that opens full screen on click, with zoom, rotate and download. Use this for any photo a person may need to inspect. */
export function ZoomableImage({ src, alt, className, caption, onError }: { src: string; alt: string; className?: string; caption?: string; onError?: () => void }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" aria-label={`Zoom ${alt}`} onClick={() => setOpen(true)} className="block w-full max-w-full cursor-zoom-in rounded-md focus-visible:outline-2 focus-visible:outline-offset-2">
        <LoadingImage src={src} alt={alt} onError={onError} className={className} />
      </button>
      {open && <ImageViewer images={[{ id: 0, url: src, name: null, caption: caption ?? alt }]} start={0} onClose={() => setOpen(false)} />}
    </>
  );
}
