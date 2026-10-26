"use client";

import { useEffect, useRef } from "react";
import { auditCustomerProfileView } from "./actions";

/** Mounting means the profile was opened; prefetching alone never records access. */
export function ProfileViewAudit({ id }: { id: string }) {
  const view = useRef<{ id: string; token: string } | null>(null);
  useEffect(() => {
    if (view.current?.id !== id) view.current = { id, token: crypto.randomUUID() };
    // Retain the token through render/effect retries; a later opening mounts a new identity.
    void auditCustomerProfileView(id, view.current.token).catch((error) => {
      console.error("Customer Profile view could not be audited", error);
    });
  }, [id]);
  return null;
}
