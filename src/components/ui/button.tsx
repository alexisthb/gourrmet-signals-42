import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * Button - design Gourrmet (cf. handoff/CHECKLIST.md sec. 2).
 *
 * Variantes :
 *  - default (primary) : bg indigo-600, hover indigo-700, pas de shadow drama
 *  - outline (ghost)   : bord, fond surface, hover sable-50
 *  - ghost (quiet)     : fond transparent, hover sable-100
 *  - link              : underline indigo
 *  - destructive       : danger fg, blanc texte
 *  - secondary         : sable-100, navy-800
 *  - premium           : conserve pour compat - alias de default sans drama
 */
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-button text-[13px] font-semibold ring-offset-background transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-indigo-700",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        outline: "border border-border bg-surface text-fg-1 hover:bg-sable-50 hover:border-border-strong",
        secondary: "bg-sable-100 text-navy-800 hover:bg-sable-200",
        ghost: "text-fg-2 hover:bg-sable-100 hover:text-navy-800",
        link: "text-indigo-600 underline-offset-4 hover:underline",
        premium: "bg-primary text-primary-foreground hover:bg-indigo-700",
      },
      size: {
        default: "h-[38px] px-4 py-2",
        sm: "h-[30px] rounded-button px-3 text-[12px]",
        lg: "h-11 rounded-button px-6 text-[14px]",
        icon: "h-[38px] w-[38px]",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
