import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * Badge - design Gourrmet (cf. handoff/CHECKLIST.md sec. 2).
 *
 * Pilule (rounded-badge = 999px), padding 4x10, font-weight 600,
 * size 11.5px. Variantes par source (presse/pappers/linkedin), par
 * statut (success/warning/danger/info/muted) ou outline.
 */
const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-badge px-2.5 py-[3px] text-[11.5px] font-semibold leading-tight transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1",
  {
    variants: {
      variant: {
        default: "bg-indigo-50 text-indigo-700",
        secondary: "bg-sable-100 text-fg-2",
        destructive: "bg-danger-bg text-danger",
        outline: "border border-border-strong bg-transparent text-fg-2",
        success: "bg-success-bg text-success",
        warning: "bg-warning-bg text-warning",
        danger: "bg-danger-bg text-danger",
        info: "bg-info-bg text-info",
        muted: "bg-sable-100 text-fg-2",
        // Sources
        presse: "bg-source-presse-bg text-source-presse-foreground",
        pappers: "bg-source-pappers-bg text-source-pappers-foreground",
        linkedin: "bg-source-linkedin-bg text-source-linkedin-foreground",
        // Alias legacy preserve
        premium: "bg-indigo-50 text-indigo-700 border border-indigo-200",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

const Badge = React.forwardRef<HTMLDivElement, BadgeProps>(
  ({ className, variant, ...props }, ref) => {
    return <div ref={ref} className={cn(badgeVariants({ variant }), className)} {...props} />;
  }
);
Badge.displayName = "Badge";

export { Badge, badgeVariants };
