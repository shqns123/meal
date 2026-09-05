import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva("inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50", {
  variants: { variant: { default: "bg-[#0075de] text-white hover:bg-[#0068c7]", secondary: "bg-[#e6f3fe] text-[#0075de] hover:bg-[#d8edfd]", ghost: "hover:bg-black/[.045] text-black/80", outline: "border border-black/10 bg-white hover:bg-black/[.025]" }, size: { default: "h-9 px-4 py-2", sm: "h-8 px-3", icon: "h-9 w-9" } },
  defaultVariants: { variant: "default", size: "default" }
});
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, ...props }, ref) => <button className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />);
Button.displayName = "Button";
