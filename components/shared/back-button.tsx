"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

interface BackButtonProps {
  /** Fallback URL when there's no browser history (e.g., direct URL access) */
  fallbackHref: string;
  /** Optional label text. Defaults to "Back" */
  label?: string;
}

/**
 * Shared back-navigation button for drill-down detail screens.
 * Uses router.back() for history-based navigation, falling back to
 * a specified default destination when no history is available.
 */
export function BackButton({ fallbackHref, label = "Back" }: BackButtonProps) {
  const router = useRouter();

  const handleBack = useCallback(() => {
    // If the page was opened directly (no referrer / history length <= 1),
    // navigate to the fallback destination instead of calling back() into the void.
    if (typeof window !== "undefined" && window.history.length <= 1) {
      router.push(fallbackHref);
    } else {
      router.back();
    }
  }, [router, fallbackHref]);

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={handleBack}
      className="gap-1 -ml-2"
    >
      <ArrowLeft className="w-4 h-4" />
      {label}
    </Button>
  );
}
