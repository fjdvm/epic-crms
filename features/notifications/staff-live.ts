const STAFF_CHANNEL = "creoms-staff";
function gateway() {
  const base = process.env.CREOMS_GATEWAY_URL?.replace(/\/$/, "");
  const key = process.env.CREOMS_GATEWAY_CALLER_KEY;
  if (!base || !key) throw new Error("Staff live gateway is not configured");
  return { base, headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" } };
}
export async function nudgeStaff() {
  const { base, headers } = gateway();
  const response = await fetch(`${base}/notifications/notifications`, {
    method: "POST", headers, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(5_000),
    body: JSON.stringify({ type: "creoms.staff.changed", title: "Staff feed changed", body: "Refresh the Staff feed.",
      sendingApp: "crms", targetApp: "crms", userIds: [STAFF_CHANNEL] }),
  });
  if (!response.ok) throw new Error(`Staff nudge refused: ${response.status}`);
}
export async function staffLiveUrl() {
  const { base, headers } = gateway();
  const response = await fetch(`${base}/live-tickets`, {
    method: "POST", headers, body: JSON.stringify({ userId: STAFF_CHANNEL }), cache: "no-store", redirect: "error", signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error(`Staff Live ticket refused: ${response.status}`);
  const { ticket } = await response.json();
  if (typeof ticket !== "string" || !ticket) throw new Error("Staff Live ticket is missing");
  return `${base.replace(/^http/, "ws")}/notifications/live?ticket=${encodeURIComponent(ticket)}`;
}
