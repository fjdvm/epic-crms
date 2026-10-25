/** A Suspense key for a page's search params: the same params give the same key whatever order the URL lists them in. */
export function searchParamsKey(raw: Record<string, string | string[] | undefined>): string {
  return JSON.stringify(Object.entries(raw).sort(([a], [b]) => a.localeCompare(b)));
}
