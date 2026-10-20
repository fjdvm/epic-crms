import { TICKETS_MODULE } from "@/lib/portal/config";
import { requireModule } from "@/lib/portal/staff";

/** Placeholder until the Conversations inbox ships; the page already belongs to the Tickets Module. */
export default async function ConversationsPage() {
  await requireModule(TICKETS_MODULE);

  return (
    <div className="space-y-1 px-xl py-7">
      <h1 className="text-2xl font-semibold leading-[normal] text-foreground">Conversations</h1>
      <p className="text-sm text-muted-foreground">Coming soon.</p>
    </div>
  );
}
