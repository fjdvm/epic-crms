import { Field } from "./field";
import { TabCard } from "./tab-card";

export function EmailsTab({ marketingOptIn }: { marketingOptIn: boolean }) {
  return (
    <TabCard title="Emails">
      <dl>
        <Field label="Marketing emails">{marketingOptIn ? "Opted in" : "Not opted in"}</Field>
      </dl>
      <div className="p-xl text-center text-muted-foreground">No marketing emails to show yet.</div>
    </TabCard>
  );
}
