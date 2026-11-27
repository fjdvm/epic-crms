"use client";

import {
  ChevronLeft,
  ChevronRight,
  Download,
  RotateCw,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";
import { LoadingImage } from "@/components/loading-image";

import { initials } from "@/features/tickets/initials";

/** One image in the chat, with who sent it and when, for the full-screen viewer. */
export interface ViewerImage {
  id: number;
  url: string;
  name: string | null;
  /** Bytes, when file-storage said. */
  size?: number | null;
  /** Who sent it, for a chat image; left out for a plain photo. */
  senderName?: string;
  /** "19 Oct, 10:13 AM", already formatted. */
  sentAt?: string;
  caption?: string;
}

/** 1.2 MB, 340 KB: how the viewer says a file's size. */
export function fileSize(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;

  return `${Math.max(1, Math.round(bytes / 1_000))} KB`;
}

const ZOOMS = [25, 50, 75, 100, 150, 200, 300];
const TOOL =
  "flex size-7 items-center justify-center rounded-md text-white/80 hover:bg-white/10 disabled:opacity-30";

/** The image full screen: step through the chat's images, zoom, turn, download. Esc or the X closes it. */
export function ImageViewer({
  images,
  start,
  onClose,
}: {
  images: ViewerImage[];
  start: number;
  onClose: () => void;
}) {
  const [index, setIndex] = useState(start);
  const [zoom, setZoom] = useState(100);
  const [turns, setTurns] = useState(0);
  const closer = useRef<HTMLButtonElement>(null);
  const image = images[index];

  const go = (to: number) => {
    if (to < 0 || to >= images.length) return;
    setIndex(to);
    setZoom(100);
    setTurns(0);
  };
  const step = (by: number) =>
    setZoom(
      (z) =>
        ZOOMS[Math.min(ZOOMS.length - 1, Math.max(0, ZOOMS.indexOf(z) + by))],
    );

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") go(index - 1);
      else if (e.key === "ArrowRight") go(index + 1);
    };
    window.addEventListener("keydown", key);

    return () => window.removeEventListener("keydown", key);
  });

  if (!image) return null;

  // Its own Radix dialog, so it stacks above any dialog it is opened from: not clipped by it, Esc closes only this layer, and focus stays inside.
  return (
    <DialogPrimitive.Root open onOpenChange={(next) => !next && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Content
          aria-describedby={undefined}
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            closer.current?.focus();
          }}
          className="pointer-events-auto fixed inset-0 z-[100000] flex flex-col bg-[#0d0b14] text-white outline-none"
        >
          <DialogPrimitive.Title className="sr-only">
            {image.senderName
              ? `Photo from ${image.senderName}`
              : (image.name ?? "Photo")}
          </DialogPrimitive.Title>
          <div className="flex shrink-0 flex-wrap items-center gap-3 px-4 py-3">
            {image.senderName && (
              <span
                aria-hidden
                className="flex size-7 items-center justify-center rounded-full bg-white text-[10px] font-semibold text-[#5b2a86]"
              >
                {initials(image.senderName)}
              </span>
            )}
            <div className="min-w-0 flex-1 leading-tight">
              {image.senderName && (
                <p className="truncate text-xs font-semibold">
                  {image.senderName}
                </p>
              )}
              <p className="truncate text-[10px] text-white/60">
                {[
                  image.sentAt && `Store chat · ${image.sentAt}`,
                  image.name,
                  image.size != null && fileSize(image.size),
                ]
                  .filter(Boolean)
                  .join(" · ") || "Photo"}
              </p>
            </div>
            {images.length > 1 && (
              <span className="rounded-full bg-white/10 px-3 py-1 text-[11px]">
                {index + 1} of {images.length}
                {image.senderName ? " in chat" : ""}
              </span>
            )}
            <div className="flex items-center gap-1">
              <button
                type="button"
                aria-label="Zoom out"
                className={TOOL}
                disabled={zoom === ZOOMS[0]}
                onClick={() => step(-1)}
              >
                <ZoomOut aria-hidden className="size-4" />
              </button>
              <span className="w-10 text-center text-[11px]">{zoom}%</span>
              <button
                type="button"
                aria-label="Zoom in"
                className={TOOL}
                disabled={zoom === ZOOMS[ZOOMS.length - 1]}
                onClick={() => step(1)}
              >
                <ZoomIn aria-hidden className="size-4" />
              </button>
              <button
                type="button"
                aria-label="Rotate"
                className={TOOL}
                onClick={() => setTurns((t) => t + 1)}
              >
                <RotateCw aria-hidden className="size-4" />
              </button>
              <a
                aria-label="Download"
                href={image.url}
                download={image.name ?? true}
                target="_blank"
                rel="noreferrer"
                className={TOOL}
              >
                <Download aria-hidden className="size-4" />
              </a>
              <button
                ref={closer}
                type="button"
                aria-label="Close"
                className={TOOL}
                onClick={onClose}
              >
                <X aria-hidden className="size-4" />
              </button>
            </div>
          </div>

          <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-auto p-6">
            {index > 0 && (
              <button
                type="button"
                aria-label="Previous image"
                onClick={() => go(index - 1)}
                className="absolute left-4 flex size-9 items-center justify-center rounded-full bg-white/15 hover:bg-white/25"
              >
                <ChevronLeft aria-hidden className="size-5" />
              </button>
            )}
            <LoadingImage
              key={image.id}
              placeholderClassName="rounded-md bg-white p-4"
              src={image.url}
              alt={
                image.senderName
                  ? `Image sent by ${image.senderName}`
                  : (image.name ?? "Photo")
              }
              style={{
                transform: `rotate(${turns * 90}deg) scale(${zoom / 100})`,
              }}
              className="max-h-full max-w-full touch-pinch-zoom rounded-sm object-contain transition-transform"
            />
            {index < images.length - 1 && (
              <button
                type="button"
                aria-label="Next image"
                onClick={() => go(index + 1)}
                className="absolute right-4 flex size-9 items-center justify-center rounded-full bg-white/15 hover:bg-white/25"
              >
                <ChevronRight aria-hidden className="size-5" />
              </button>
            )}
          </div>

          <div className="flex shrink-0 flex-col items-center gap-3 px-4 pt-1 pb-4">
            {image.caption && (
              <p className="rounded-full bg-white/10 px-3 py-1 text-[11px]">
                {image.caption}
              </p>
            )}
            {images.length > 1 && (
              <div className="flex max-w-full gap-2 overflow-x-auto">
                {images.map((other, i) => (
                  <button
                    key={other.id}
                    type="button"
                    aria-label={`Show image ${i + 1}`}
                    aria-current={i === index ? "true" : undefined}
                    onClick={() => go(i)}
                    className={cn(
                      "size-10 shrink-0 overflow-hidden rounded-md border-2",
                      i === index
                        ? "border-white"
                        : "border-transparent opacity-60",
                    )}
                  >
                    <LoadingImage
                      placeholderClassName="bg-white"
                      src={other.url}
                      alt=""
                      className="size-full object-cover"
                    />
                  </button>
                ))}
              </div>
            )}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
