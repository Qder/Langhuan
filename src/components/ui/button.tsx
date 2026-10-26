"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

type Variant = "default" | "accent" | "ghost" | "outline" | "secondary" | "danger";
type Size = "sm" | "md" | "lg" | "icon";

const variants: Record<Variant, string> = {
  default:
    "bg-[var(--fg)] text-[var(--bg)] hover:opacity-90",
  accent:
    "bg-[var(--accent)] text-white hover:brightness-110 shadow-sm",
  ghost: "bg-transparent hover:bg-[var(--hover)] text-[var(--fg)]",
  outline:
    "border border-[var(--border)] bg-transparent hover:bg-[var(--hover)]",
  secondary:
    "bg-[var(--card)] border border-[var(--border)] hover:bg-[var(--hover)]",
  danger: "bg-[var(--accent)]/10 text-[var(--accent)] hover:bg-[var(--accent)]/20",
};

const sizes: Record<Size, string> = {
  sm: "h-8 px-2.5 text-xs rounded-xl gap-1.5",
  md: "h-9 px-3 text-sm rounded-xl gap-2",
  lg: "h-11 px-4 text-sm rounded-2xl gap-2",
  icon: "h-9 w-9 rounded-xl",
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "ghost", size = "md", ...props }, ref) => (
    <button
      ref={ref}
      className={cn(
        "inline-flex items-center justify-center font-ui font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/40 disabled:opacity-40 disabled:pointer-events-none",
        variants[variant],
        sizes[size],
        className
      )}
      {...props}
    />
  )
);
Button.displayName = "Button";
