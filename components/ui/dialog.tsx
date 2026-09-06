"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

type DialogProps = {
  children: React.ReactNode;
  className?: string;
  labelledBy: string;
  onClose: () => void;
};

export function Dialog({
  children,
  className,
  labelledBy,
  onClose,
}: DialogProps) {
  const panelRef = React.useRef<HTMLDivElement>(null);
  const closeRef = React.useRef(onClose);
  closeRef.current = onClose;

  React.useEffect(() => {
    const previouslyFocused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const panel = panelRef.current;
    panel
      ?.querySelector<HTMLElement>(
        "[data-autofocus], button, input, textarea, select, a[href]",
      )
      ?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab" || !panel) return;
      const focusable = [
        ...panel.querySelectorAll<HTMLElement>(
          "button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])",
        ),
      ];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      }
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = "";
      previouslyFocused?.focus();
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 grid overflow-y-auto bg-black/30 p-4 sm:place-items-center"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        onMouseDown={(event) => event.stopPropagation()}
        className={cn(
          "my-auto w-full rounded-xl border border-black/[.08] bg-white",
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
}
