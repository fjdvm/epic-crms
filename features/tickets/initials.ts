/** "Paolo Dizon" → "PD": the letters in a chat's avatar. A plain module so server and client components can both call it. */
export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
