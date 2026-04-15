// ------------------------------------------------------------------
// Component: ContextMenu
// Responsibility: Floating menu positioned at click coordinates with
//                 click-outside / Escape to dismiss. Used by Sidebar
//                 for the right-click conversation menu (#14).
// ------------------------------------------------------------------

import { useEffect, useRef } from "react";

export interface MenuItem {
  label: string;
  onSelect: () => void;
  destructive?: boolean;
}

export function ContextMenu({
  x,
  y,
  items,
  onClose,
  ariaLabel,
}: {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
  ariaLabel: string;
}): JSX.Element {
  const ref = useRef<HTMLUListElement>(null);
  useEffect(() => {
    const onDocClick = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <ul
      ref={ref}
      role="menu"
      aria-label={ariaLabel}
      style={{ position: "fixed", top: y, left: x, zIndex: 100 }}
      className="min-w-40 rounded border border-neutral-200 bg-white py-1 text-sm shadow-lg"
    >
      {items.map((item) => (
        <li key={item.label} role="none">
          <button
            role="menuitem"
            onClick={() => {
              item.onSelect();
              onClose();
            }}
            className={`block w-full px-3 py-1.5 text-left hover:bg-neutral-100 ${
              item.destructive ? "text-red-700" : "text-neutral-900"
            }`}
          >
            {item.label}
          </button>
        </li>
      ))}
    </ul>
  );
}
