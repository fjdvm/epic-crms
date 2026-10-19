export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <dt className="text-label-md text-muted-foreground">{label}</dt>
      <dd className="text-body-md text-foreground">{children}</dd>
    </div>
  );
}
