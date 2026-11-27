"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { createContext, useContext, useOptimistic, useTransition } from "react";

import { ChatSkeleton } from "./conversations-skeleton";

interface Opening {
  /** The Ticket whose chat was clicked and has not arrived yet. */
  ticketId: number | null;
  open: (ticketId: number, href: string) => void;
}

const OpeningContext = createContext<Opening | null>(null);

/** Opening a chat answers at once: its row highlights and the chat column alone shows a skeleton until it lands. */
export function ConversationsNavigation({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [ticketId, setTicketId] = useOptimistic<number | null>(null);

  const open = (next: number, href: string) => {
    startTransition(async () => {
      setTicketId(next);
      await router.push(href);
    });
  };

  return <OpeningContext.Provider value={{ ticketId, open }}>{children}</OpeningContext.Provider>;
}

/** An inbox row. Outside `ConversationsNavigation` it is a plain link. */
export function ChatLink({
  ticketId, href, current, className, children,
}: { ticketId: number; href: string; current: boolean; className: string; children: React.ReactNode }) {
  const opening = useContext(OpeningContext);
  const selected = opening && opening.ticketId !== null ? opening.ticketId === ticketId : current;

  return (
    <Link
      href={href}
      aria-current={selected ? "true" : undefined}
      className={className}
      onClick={(event) => {
        // A new tab or window is the browser's business.
        if (!opening || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
        event.preventDefault();
        if (!selected) opening.open(ticketId, href);
      }}
    >
      {children}
    </Link>
  );
}

/** The chat column: a skeleton from the click until the new chat's own loading takes over. */
export function ChatPane({ children }: { children: React.ReactNode }) {
  const opening = useContext(OpeningContext);

  return opening && opening.ticketId !== null ? <ChatSkeleton /> : children;
}
