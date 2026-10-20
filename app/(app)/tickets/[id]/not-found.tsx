import Link from "next/link";

export default function NotFound() {
  return (
    <div className="p-md sm:p-lg space-y-sm">
      <h1 className="text-headline-md text-foreground">Ticket not found</h1>
      <p className="text-muted-foreground">There is no Ticket with this number.</p>
      <Link href="/tickets" className="underline">
        Back to Tickets
      </Link>
    </div>
  );
}
