import { redirect } from "next/navigation";

import { UnusualActivityCards } from "@/features/dashboard/unusual-activity-cards";
import { DASHBOARD_MODULE } from "@/lib/portal/config";
import { shopRole } from "@/lib/portal/roles";
import { canSeeAiInsights, requireModule } from "@/lib/portal/staff";

/** AI Insights: the Unusual activity the AI spotted. Managers dismiss; Admin views; Staff go back to the Summary. */
export default async function AiInsightsPage() {
  const staff = await requireModule(DASHBOARD_MODULE);
  if (!canSeeAiInsights(staff.role)) redirect("/dashboard");
  const canDismiss = shopRole(staff.role) === "manager";

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 py-7 sm:px-8">
      <div className="min-w-0 space-y-1 leading-[normal]">
        <h1 className="text-2xl font-semibold text-[#18181b]">AI Insights</h1>
        <p className="text-sm text-[#71717a]">Unusual activity the AI spotted, for a person to check</p>
      </div>
      <UnusualActivityCards
        canDismiss={canDismiss}
        emptyState={
          <section aria-label="Unusual activity" className="rounded-2xl border border-[#e6e1ee] bg-white px-5 py-4 leading-[normal]">
            <h2 className="text-[13px] font-medium text-[#71717a]">Unusual activity</h2>
            <p className="mt-2 text-sm text-[#71717a]">No unusual activity right now.</p>
          </section>
        }
      />
    </div>
  );
}
