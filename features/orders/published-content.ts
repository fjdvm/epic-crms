import { crmsDatabase } from "@/lib/crms-db";

import { loadProductContent } from "./product-content";

/** The server's reader for what Staff published; passed into `loadStock` and `loadStockSize`. */
export const readPublishedContent = (productIds: number[]) => loadProductContent(crmsDatabase(), productIds);
