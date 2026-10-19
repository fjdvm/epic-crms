import Link from "next/link";

export default function NotFound() {
  return (
    <div className="p-md sm:p-lg space-y-sm">
      <h1 className="text-headline-md text-foreground">Customer not found</h1>
      <p className="text-muted-foreground">
        There is no Customer with this id. They may not have verified their email yet.
      </p>
      <Link href="/customer-profiles" className="underline">
        Back to Customer Profiles
      </Link>
    </div>
  );
}
