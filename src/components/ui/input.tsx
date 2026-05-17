import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Input - design Gourrmet (cf. handoff/CHECKLIST.md sec. 2).
 * h-9, rounded-input (10px), border sable, focus indigo-600, fond surface.
 */
const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-9 w-full rounded-input border border-border bg-surface px-3 py-2 text-[13.5px] ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-fg-1 placeholder:text-fg-3 focus-visible:outline-none focus-visible:border-indigo-600 focus-visible:ring-2 focus-visible:ring-indigo-100 disabled:cursor-not-allowed disabled:opacity-50 transition-colors duration-150",
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };
