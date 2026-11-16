/** Fixed cap shared with the Category and Priority suggestion. */
export const SENT_TEXT_MAX = 4000;

/** Only subject and public Message bodies. Callers may supply private values for local redaction, never transmission. */
export function ticketText(subject: string, messages: { sender: "customer" | "staff"; body: string }[], privateValues: string[] = []): string {
  const scrub = (text: string) => {
    for (const value of [...new Set(privateValues)].filter((v) => v.trim().length > 1).sort((a, b) => b.length - a.length)) {
      const escaped = value.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      text = text.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "giu"), "[private]");
    }
    return text.replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, "[email]").replace(/\+?\d[\d\s()./\p{Pd}\u2212\u200b-\u200d\u2060]{7,}\d/gu, "[number]");
  };
  // Mask before truncating so a cut email or phone number cannot slip through.
  const head = `Subject: ${scrub(subject.trim())}`.slice(0, 1000);
  const body = messages.filter((m) => m.body.trim()).map((m) =>
    `${m.sender === "customer" ? "Customer" : "Staff"}: ${scrub(m.body.trim().replace(/\s+/g, " "))}`,
  ).join("\n");
  return `${head}\n${body.slice(-(SENT_TEXT_MAX - head.length - 1))}`;
}
