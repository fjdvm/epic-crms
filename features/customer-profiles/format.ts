const pesos = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" });
const dates = new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeZone: "Asia/Manila" });

/** Centavos shown as pesos. */
export function formatPesos(centavos: number): string {
  return pesos.format(centavos / 100);
}

export function formatDate(date: Date): string {
  return dates.format(date);
}
