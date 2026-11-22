import { crmsDatabase } from "@/lib/crms-db";

import { loadProductContent } from "./product-content";
import { deleteMirrorOne, loadMirror, saveMirror, saveMirrorOne, type StockMirror } from "./stock-mirror";

/** Server-side readers passed into `loadStock` and `loadStockSize` (stock.ts is bundled for the browser, so it cannot import the database). The reader for what Staff published: */
export const readPublishedContent = (productIds: number[]) => loadProductContent(crmsDatabase(), productIds);

/** CREOMS's copy of the IMS, for `loadStock` and `loadStockSize`. */
export const stockMirror: StockMirror = {
  load: () => loadMirror(crmsDatabase()),
  save: (feed, stock) => saveMirror(crmsDatabase(), feed, stock),
  saveOne: (item, held) => saveMirrorOne(crmsDatabase(), item, held),
  deleteOne: (productId) => deleteMirrorOne(crmsDatabase(), productId),
};
