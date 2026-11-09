/** Where Staff open an Order's payment-proof screenshot when it is a File in file-storage. */
export const paymentScreenshotPath = (orderId: number) => `/api/orders/${orderId}/payment-proof`;

/** The File route for a new proof, else the legacy Vercel Blob pathname (which cannot be opened). */
export const paymentScreenshotSource = (orderId: number, fileId: string | null, pathname: string | null) =>
  fileId ? paymentScreenshotPath(orderId) : pathname;

/** A screenshot can be shown as an image only when it is an address or the File route, not a bare pathname. */
export const isViewableScreenshot = (value: string | null | undefined): value is string =>
  typeof value === "string" && (/^https?:\/\//.test(value) || /^\/api\/orders\/\d+\/payment-proof$/.test(value));
