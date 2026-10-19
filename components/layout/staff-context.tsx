"use client";

import React, { createContext, useContext } from "react";
import type { Staff } from "@/lib/portal/client";

const StaffContext = createContext<Staff | null>(null);

export function StaffProvider({
  staff,
  children,
}: {
  staff: Staff;
  children: React.ReactNode;
}) {
  return <StaffContext.Provider value={staff}>{children}</StaffContext.Provider>;
}

export function useStaff(): Staff {
  const staff = useContext(StaffContext);

  if (!staff) {
    throw new Error("useStaff must be used inside StaffProvider");
  }

  return staff;
}
