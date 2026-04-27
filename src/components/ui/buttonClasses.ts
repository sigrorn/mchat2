// ------------------------------------------------------------------
// Component: Button class helpers (#198)
// Responsibility: Pure className builders for the OutlineButton /
//                 PrimaryButton / DangerButton primitives. Kept
//                 separate from the JSX wrappers so the "always
//                 includes text-color" invariant can be unit-tested
//                 without a DOM.
// History:        Introduced after #172 — the second time outline
//                 buttons shipped without a text-color class. These
//                 helpers make that bug class structurally
//                 impossible: the color is part of the variant.
// Collaborators: components/ui/Button (JSX wrappers), every existing
//                button site that previously inlined Tailwind class
//                strings.
// ------------------------------------------------------------------

export type ButtonSize = "xs" | "sm" | "md" | "lg";

// Size mapping picked to cover the existing inline button styles
// without visual regressions. `sm` is the persona-form size (px-2 py-1
// text-xs); SidebarFooter uses `md` with a !text-xs override.
const SIZE_CLASS: Record<ButtonSize, string> = {
  xs: "px-2 py-0.5 text-xs",
  sm: "px-2 py-1 text-xs",
  md: "px-3 py-1.5 text-sm",
  lg: "px-3 py-2 text-sm",
};

const ROUNDED = "rounded";

function compose(parts: readonly string[]): string {
  return parts.filter(Boolean).join(" ");
}

export function outlineButtonClass(size: ButtonSize = "md", extra = ""): string {
  return compose([
    ROUNDED,
    "border border-neutral-300 text-neutral-700 hover:bg-neutral-100",
    SIZE_CLASS[size],
    extra,
  ]);
}

export function primaryButtonClass(size: ButtonSize = "md", extra = ""): string {
  return compose([
    ROUNDED,
    "bg-neutral-900 text-white hover:bg-neutral-700 disabled:opacity-50",
    SIZE_CLASS[size],
    extra,
  ]);
}

export function dangerButtonClass(size: ButtonSize = "md", extra = ""): string {
  return compose([
    ROUNDED,
    "border border-red-600 text-red-700 hover:bg-red-50",
    SIZE_CLASS[size],
    extra,
  ]);
}
