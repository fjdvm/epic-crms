/** Where Staff open an Order's payment-proof screenshot when it is a File in file-storage; a proof id picks that one proof instead of the Order's latest. */
export const paymentScreenshotPath = (orderId: number, proofId?: number) =>
  `/api/orders/${orderId}/payment-proof${proofId === undefined ? "" : `?proof=${proofId}`}`;

/** The File route for a new proof, else the legacy Vercel Blob pathname (which cannot be opened). */
export const paymentScreenshotSource = (orderId: number, fileId: string | null, pathname: string | null, proofId?: number) =>
  fileId ? paymentScreenshotPath(orderId, proofId) : pathname;

/** A screenshot can be shown as an image only when it is an address or the File route, not a bare pathname. */
export const isViewableScreenshot = (value: string | null | undefined): value is string =>
  typeof value === "string" && (/^https?:\/\//.test(value) || /^\/api\/orders\/\d+\/payment-proof(\?proof=\d+)?$/.test(value));
