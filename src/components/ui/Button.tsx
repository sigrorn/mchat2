// ------------------------------------------------------------------
// Component: Button primitives (OutlineButton / PrimaryButton /
//            DangerButton)
// Responsibility: Thin <button> wrappers that bake in the variant's
//                 colors, sizing, hover and disabled states.
//                 Replaces inline className strings at every
//                 button site so the "forgot text-color" bug
//                 class from #172 cannot recur.
// Collaborators: components/ui/buttonClasses (pure helpers, the
//                tested surface).
// ------------------------------------------------------------------

import type { ButtonHTMLAttributes, JSX } from "react";
import {
  outlineButtonClass,
  primaryButtonClass,
  dangerButtonClass,
  type ButtonSize,
} from "./buttonClasses";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  size?: ButtonSize;
};

export function OutlineButton({
  size = "md",
  className = "",
  type = "button",
  ...rest
}: Props): JSX.Element {
  return <button {...rest} type={type} className={outlineButtonClass(size, className)} />;
}

export function PrimaryButton({
  size = "md",
  className = "",
  type = "button",
  ...rest
}: Props): JSX.Element {
  return <button {...rest} type={type} className={primaryButtonClass(size, className)} />;
}

export function DangerButton({
  size = "md",
  className = "",
  type = "button",
  ...rest
}: Props): JSX.Element {
  return <button {...rest} type={type} className={dangerButtonClass(size, className)} />;
}
