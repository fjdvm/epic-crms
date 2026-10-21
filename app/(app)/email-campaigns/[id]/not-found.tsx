import Link from "next/link";

export default function NotFound() {
  return (
    <div className="p-md sm:p-lg space-y-sm">
      <h1 className="text-headline-md text-foreground">Announcement not found</h1>
      <p className="text-muted-foreground">It may have been deleted by a colleague.</p>
      <Link href="/email-campaigns" className="underline">
        Back to Email campaigns
      </Link>
    </div>
  );
}
