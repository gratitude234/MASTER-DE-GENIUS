import * as React from "react";
import { skeletonClasses } from "@/components/ui/variants";

export type SkeletonProps = React.HTMLAttributes<HTMLDivElement>;

/**
 * A neutral placeholder block. Geometry is entirely the caller's — pass width,
 * height and radius through `className` so each route's loading screen can
 * mirror its own card shapes.
 *
 * Hidden from assistive technology: a loading screen should announce itself
 * once, not once per block.
 */
export function Skeleton({ className, ...props }: SkeletonProps) {
  return <div aria-hidden="true" className={skeletonClasses(className)} {...props} />;
}
