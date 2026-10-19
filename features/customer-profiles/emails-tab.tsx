import { Field } from "./field";

export function EmailsTab({ marketingOptIn }: { marketingOptIn: boolean }) {
  return (
    <div className="space-y-md">
      <dl>
        <Field label="Marketing emails">{marketingOptIn ? "Opted in" : "Not opted in"}</Field>
      </dl>
      <div className="p-xl text-center text-muted-foreground border border-border rounded-lg">
        No marketing emails to show yet.
      </div>
    </div>
  );
}
