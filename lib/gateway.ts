import type { SendAppEmail } from "@/features/tickets/ticket-actions";

/** Queues an App email through the api-gateway's notifications service, as the "crms" Caller. */
export const sendAppEmail: SendAppEmail = async (email) => {
  const base = process.env.CREOMS_GATEWAY_URL;
  const key = process.env.CREOMS_GATEWAY_CALLER_KEY;

  if (!base || !key)
    throw new Error("CREOMS_GATEWAY_URL and CREOMS_GATEWAY_CALLER_KEY must be set; see .env.example");

  const response = await fetch(`${base.replace(/\/$/, "")}/notifications/emails/app`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ...email, app: "crms" }),
  });

  if (!response.ok) throw new Error(`The gateway refused the email: ${response.status}`);
};

/** Where the Customer reviews a Ticket in the storefront. */
export function storefrontTicketUrl(id: number): string {
  const base = process.env.CREOMS_STOREFRONT_URL;

  if (!base) throw new Error("CREOMS_STOREFRONT_URL is not set; see .env.example");

  return `${base.replace(/\/$/, "")}/support/${id}`;
}
