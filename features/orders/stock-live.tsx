"use client";

import { useState, useSyncExternalStore } from "react";

import { createLiveStock } from "./stock-socket";
import type { StockPage } from "./stock";
import { StockView } from "./stock-view";

/**
 * Products & Stocks. It opens on CREOMS's own copy of the IMS, refreshes it once in the background, and is kept
 * current by the Staff stock channel (see `createLiveStock`). No effect and no timer fetches anything.
 */
export function LiveStock({ page: initial, canEdit = false, canPrice = false, initialQuery = "" }: {
  page: StockPage; canEdit?: boolean;
  /** Manager-level only: the shop price is money. */
  canPrice?: boolean;
  /** The search the page opened with (`?q=`). */
  initialQuery?: string;
}) {
  const [store] = useState(() => createLiveStock(initial));
  // A new server render wins over what the channel built on the old one.
  if (store.base !== initial) store.rebase(initial);
  const page = useSyncExternalStore(store.subscribe, store.getSnapshot, () => initial);
  return <StockView page={page} canEdit={canEdit} canPrice={canPrice} initialQuery={initialQuery} />;
}
