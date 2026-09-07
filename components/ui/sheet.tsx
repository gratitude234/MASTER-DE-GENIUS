"use client";

import * as React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { sheetPanelClasses, typography, type SheetSize } from "@/components/ui/variants";

export interface SheetProps {
  open: boolean;
  /** Called whenever the sheet asks to close: Escape, overlay, close button. */
  onClose: () => void;
  /** Accessible name. Always required, even when visually hidden. */
  title: string;
  /** Renders the title for screen readers only, for sheets with custom chrome. */
  hideTitle?: boolean;
  description?: string;
  /** Pinned below the scrolling body — confirmation actions live here. */
  footer?: React.ReactNode;
  /** Suppresses Escape, the overlay and the close button (e.g. while submitting). */
  dismissible?: boolean;
  size?: SheetSize;
  className?: string;
  bodyClassName?: string;
  children?: React.ReactNode;
}

/**
 * The one overlay primitive: a bottom sheet on mobile, a centred dialog from
 * 640px up.
 *
 * It is a native <dialog> opened with `showModal()`, so the focus trap, focus
 * restoration on close, Escape handling, inertness of the page behind it and
 * the top-layer stacking all come from the platform rather than from
 * hand-written key handlers. Layout and motion live in app/globals.css under
 * `dialog[data-sheet]`, where the entrance animation is already wrapped in a
 * `prefers-reduced-motion` guard.
 */
export function Sheet({
  open,
  onClose,
  title,
  hideTitle = false,
  description,
  footer,
  dismissible = true,
  size = "md",
  className,
  bodyClassName,
  children,
}: SheetProps) {
  const dialogRef = React.useRef<HTMLDialogElement>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);
  const titleId = React.useId();
  const descriptionId = React.useId();

  React.useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open && !dialog.open) {
      dialog.showModal();
      // Land focus on the panel rather than on whichever control happens to be
      // first in the DOM, so the sheet is announced before its close button.
      panelRef.current?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  // The page behind a modal must not scroll under the sheet on touch devices.
  React.useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  const requestClose = React.useCallback(() => {
    if (dismissible) onClose();
  }, [dismissible, onClose]);

  return (
    <dialog
      ref={dialogRef}
      data-sheet=""
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      // Escape reaches the dialog as `cancel`. It is intercepted so React state
      // stays the source of truth, and so a non-dismissible sheet can refuse.
      onCancel={(event) => {
        event.preventDefault();
        requestClose();
      }}
      // Fires when the element closes by any route; keeps `open` honest.
      onClose={() => {
        if (open) onClose();
      }}
      // A click that lands on the dialog itself landed outside the panel.
      onClick={(event) => {
        if (event.target === dialogRef.current) requestClose();
      }}
    >
      {open ? (
        <div
          ref={panelRef}
          data-sheet-panel=""
          tabIndex={-1}
          className={sheetPanelClasses({ size, className })}
        >
          <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 pb-4 pt-5">
            <div className="min-w-0">
              <h2 id={titleId} className={hideTitle ? "sr-only" : typography.h2}>
                {title}
              </h2>
              {description ? (
                <p id={descriptionId} className={cn(typography.caption, "mt-1")}>
                  {description}
                </p>
              ) : null}
            </div>
            {dismissible ? (
              <Button
                variant="ghost"
                size="sm"
                iconOnly
                aria-label={`Close ${title}`}
                onClick={onClose}
                className="-mr-1 shrink-0 rounded-full bg-slate-100 text-slate-600 hover:bg-slate-200"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </Button>
            ) : null}
          </div>

          <div className={cn("flex-1 overflow-y-auto px-5 py-5", bodyClassName)}>{children}</div>

          {footer ? (
            <div className="border-t border-slate-100 px-5 py-4">{footer}</div>
          ) : null}
        </div>
      ) : null}
    </dialog>
  );
}
