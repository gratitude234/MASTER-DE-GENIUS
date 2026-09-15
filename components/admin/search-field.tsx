"use client";

import { useEffect, useRef } from "react";
import { fieldClasses } from "@/components/ui/variants";

/**
 * A search box that applies its filter form once typing pauses, so a query
 * does not need an extra click and the server is not asked on every keystroke.
 */
export function SearchField({ name = "search", defaultValue, placeholder, label }: { name?: string; defaultValue?: string; placeholder?: string; label: string }) {
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  return (
    <input
      type="search"
      name={name}
      aria-label={label}
      defaultValue={defaultValue}
      placeholder={placeholder}
      maxLength={120}
      autoComplete="off"
      onChange={(event) => {
        const form = event.currentTarget.form;
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => form?.requestSubmit(), 450);
      }}
      className={fieldClasses({ size: "md" })}
    />
  );
}
