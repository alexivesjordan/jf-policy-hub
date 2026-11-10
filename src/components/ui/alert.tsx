import type { ReactNode } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const alertVariants = cva(
  "relative grid w-full grid-cols-[auto_1fr] items-start gap-x-3 gap-y-0.5 rounded-2xl border px-4 py-3 text-sm leading-6",
  {
    variants: {
      variant: {
        default: "border-border bg-card text-foreground",
        destructive: "border-destructive/50 bg-card text-foreground",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

function Alert({
  className,
  variant,
  children,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
  return (
    <div role="status" data-slot="alert" className={cn(alertVariants({ variant }), className)} {...props}>
      {children}
    </div>
  );
}

function AlertTitle({ className, ...props }: React.ComponentProps<"p">) {
  return <p data-slot="alert-title" className={cn("font-semibold", className)} {...props} />;
}

function AlertDescription({ className, children, ...props }: React.ComponentProps<"div"> & { children?: ReactNode }) {
  return (
    <div data-slot="alert-description" className={cn("text-sm text-muted-foreground [&_p]:leading-6", className)} {...props}>
      {children}
    </div>
  );
}

export { Alert, AlertTitle, AlertDescription };
