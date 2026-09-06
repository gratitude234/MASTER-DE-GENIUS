"use client";
import { useEffect } from "react";
import { claimOwner } from "@/features/offline/storage";
export function DeviceOwner({ userId }: { userId: string }) {
  useEffect(() => { void claimOwner(userId).catch(() => {}); }, [userId]);
  return null;
}
