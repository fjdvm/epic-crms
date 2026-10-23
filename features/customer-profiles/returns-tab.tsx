import { ReturnsTable } from "@/features/returns/returns-table";
import type { ReturnRow } from "@/features/returns/returns";

import { TabCard } from "./tab-card";

export function ReturnsTab({
  returns,
  canOpenOrder = false,
}: {
  returns: ReturnRow[] | null;
  canOpenOrder?: boolean;
}) {
  return (
    <TabCard title="Returns" note="Read-only here · managed in Sales">
      <ReturnsTable returns={returns} showOrder canOpenOrder={canOpenOrder} empty="This customer has no Returns." />
    </TabCard>
  );
}
