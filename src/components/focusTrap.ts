// ------------------------------------------------------------------
// Component: Focus-trap helper + hook (#127)
// Responsibility: Pure key-handling logic (focusTrapAction) plus a
//                 React hook (useFocusTrap) that wires the helper to
//                 an actual modal container. Keeps Tab focus inside
//                 the dialog, closes on Escape, restores focus on
//                 unmount.
// Collaborators: SettingsDialog, SettingsGeneralDialog — any component
//                rendering a role="dialog" overlay.
// ------------------------------------------------------------------

import { useEffect, type RefObject } from "react";

export type FocusTrapAction = "close" | "wrap-to-first" | "wrap-to-last" | null;

/**
 * Pure decision function: given a key event and focus state, return
 * what the caller should do. Kept dependency-free so it is testable
 * without a DOM.
 */
export function focusTrapAction(
  ev: Pick<KeyboardEvent, "key" | "shiftKey">,
  focus: { onFirst: boolean; onLast: boolean; hasFocusables: boolean },
): FocusTrapAction {
  if (ev.key === "Escape") return "close";
  if (ev.key !== "Tab") return null;
  if (!focus.hasFocusables) return null;
  if (ev.shiftKey && focus.onFirst) return "wrap-to-last";
  if (!ev.shiftKey && focus.onLast) return "wrap-to-first";
  return null;
}

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function focusableIn(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => !el.hasAttribute("disabled") && el.tabIndex !== -1,
  );
}

/**
 * Focus-trap for a modal dialog. On mount: focus the first focusable
 * inside `containerRef`, save the previously-focused element. While
 * open: Tab wraps, Escape calls onClose. On unmount: restore focus.
 */
export function useFocusTrap(
  containerRef: RefObject<HTMLElement | null>,
  onClose: () => void,
): void {
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    const first = focusableIn(container)[0];
    first?.focus();

    const handleKey = (ev: KeyboardEvent): void => {
      const focusables = focusableIn(container);
      const active = document.activeElement as HTMLElement | null;
      const onFirst = focusables.length > 0 && active === focusables[0];
      const onLast = focusables.length > 0 && active === focusables[focusables.length - 1];
      const action = focusTrapAction(ev, {
        onFirst,
        onLast,
        hasFocusables: focusables.length > 0,
      });
      if (action === "close") {
        ev.preventDefault();
        onClose();
        return;
      }
      if (action === "wrap-to-first") {
        ev.preventDefault();
        focusables[0]?.focus();
        return;
      }
      if (action === "wrap-to-last") {
        ev.preventDefault();
        focusables[focusables.length - 1]?.focus();
      }
    };

    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("keydown", handleKey);
      previouslyFocused?.focus?.();
    };
  }, [containerRef, onClose]);
}
