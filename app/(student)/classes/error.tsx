"use client";
import { RouteError } from "@/components/ui/route-error";
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) { return <RouteError error={error} title="Master Classes could not load" description="Please try again. Your existing class requests are safe." reset={reset} />; }
