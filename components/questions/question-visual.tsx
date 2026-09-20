"use client";

import { useState } from "react";
import { ImageOff, Maximize2, X } from "lucide-react";

import { cn } from "@/lib/utils";
import type { QuestionAsset } from "@/types/domain";

/**
 * The one renderer for a question's visual.
 *
 * Practice, Mock, answer review and the admin inspector all show the same
 * diagram, so they show it through the same component. Three separate copies is
 * how a graph ends up legible in Practice and cropped in the exam.
 *
 * The exam context sets the rules:
 *
 *   - a graph or a table carries small printed labels, so it is never reduced
 *     to a thumbnail: it fills the column width on a phone and is capped only
 *     by viewport height, never by a fixed pixel box;
 *   - `object-contain` with `h-auto w-full` means the intrinsic aspect ratio is
 *     always preserved and nothing is ever cropped;
 *   - the figure cannot overflow horizontally, because the image is bounded by
 *     its container rather than by its own natural width;
 *   - every visual can be opened full-size, because a candidate reading an axis
 *     label on a 360px screen needs to zoom;
 *   - a remote image that fails to load says so in words. A broken-image icon
 *     next to "From the graph, it can be inferred that" tells a student nothing
 *     about whether the question is broken or their connection is.
 */

/** Alt text is the provider's when it supplied one; otherwise honest and generic. */
function altTextFor(asset: QuestionAsset): string {
  return asset.altText?.trim() || "Illustration supplied with this question";
}

interface QuestionVisualProps {
  asset: QuestionAsset;
  /** Compact spacing for dense surfaces such as the admin inspector. */
  compact?: boolean;
  className?: string;
}

export function QuestionVisual({ asset, compact = false, className }: QuestionVisualProps) {
  const [failed, setFailed] = useState(false);
  const [zoomed, setZoomed] = useState(false);
  const alt = altTextFor(asset);

  if (failed) {
    return (
      <figure
        className={cn(
          "rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-center",
          className,
        )}
      >
        <ImageOff className="mx-auto h-5 w-5 text-slate-400" aria-hidden="true" />
        <figcaption className="mt-2 text-[12.5px] leading-[1.6] text-slate-600">
          This question&rsquo;s illustration could not be loaded. Check your connection and reload
          the page — the question needs it.
        </figcaption>
        <a
          href={asset.url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-block text-[12px] font-semibold text-brand-500 underline"
        >
          Open the image directly
        </a>
      </figure>
    );
  }

  return (
    <>
      <figure
        className={cn(
          "overflow-hidden rounded-2xl border border-slate-200 bg-white",
          compact ? "p-1.5" : "p-2",
          className,
        )}
      >
        <button
          type="button"
          onClick={() => setZoomed(true)}
          aria-label={`Enlarge illustration: ${alt}`}
          className="group relative block w-full cursor-zoom-in overflow-hidden rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={asset.url}
            alt={alt}
            loading="lazy"
            decoding="async"
            onError={() => setFailed(true)}
            className={cn(
              // w-full + h-auto + object-contain: full column width, true aspect
              // ratio, no crop. max-h is a viewport fraction rather than a pixel
              // box so a tall table stays readable on a small screen.
              "h-auto w-full rounded-xl object-contain",
              compact ? "max-h-[45vh]" : "max-h-[60vh]",
            )}
          />
          <span
            aria-hidden="true"
            className="absolute bottom-2 right-2 flex items-center gap-1 rounded-lg bg-slate-900/70 px-2 py-1 text-[11px] font-semibold text-white"
          >
            <Maximize2 className="h-3 w-3" />
            Tap to enlarge
          </span>
        </button>
        {asset.caption ? (
          <figcaption className="px-2 pb-1 pt-2 text-xs leading-[1.5] text-slate-500">{asset.caption}</figcaption>
        ) : null}
      </figure>

      {zoomed ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={alt}
          className="fixed inset-0 z-50 flex flex-col bg-slate-950/95"
        >
          <div className="flex justify-end p-3">
            <button
              type="button"
              onClick={() => setZoomed(false)}
              className="flex min-h-11 items-center gap-2 rounded-xl bg-white/10 px-3.5 text-[13px] font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              <X className="h-4 w-4" aria-hidden="true" />
              Close
            </button>
          </div>
          {/* Scroll in both directions so a wide graph can be panned rather
              than shrunk below the size its labels need. */}
          <div className="flex-1 overflow-auto p-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={asset.url}
              alt={alt}
              onError={() => { setFailed(true); setZoomed(false); }}
              className="mx-auto h-auto w-full max-w-3xl object-contain"
            />
          </div>
        </div>
      ) : null}
    </>
  );
}

/**
 * Every visual belonging to one question, in provider order.
 *
 * Renders nothing when there are none, so a call site is a single unconditional
 * line and cannot forget the empty case.
 */
export function QuestionVisuals({
  assets,
  compact = false,
  className,
}: {
  assets: readonly QuestionAsset[];
  compact?: boolean;
  className?: string;
}) {
  if (assets.length === 0) return null;
  return (
    <div className={cn("grid gap-3", className)}>
      {assets.map((asset) => (
        <QuestionVisual key={asset.id} asset={asset} compact={compact} />
      ))}
    </div>
  );
}
