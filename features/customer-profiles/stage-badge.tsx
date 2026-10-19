import { Badge, type BadgeProps } from "@/components/ui/badge";

import { STAGE_LABELS, type Stage } from "./rules";

const VARIANTS: Record<Stage, BadgeProps["variant"]> = {
  new: "info",
  "first-order": "info",
  repeat: "purple",
  "at-risk": "warning",
  lost: "secondary",
};

export function StageBadge({ stage }: { stage: Stage }) {
  return <Badge variant={VARIANTS[stage]}>{STAGE_LABELS[stage]}</Badge>;
}
