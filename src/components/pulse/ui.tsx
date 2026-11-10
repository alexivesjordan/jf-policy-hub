import Link from "next/link";
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from "react";
import { Badge as ShadcnBadge } from "@/components/ui/badge";
import { Button as ShadcnButton } from "@/components/ui/button";
import { Card as ShadcnCard, CardContent } from "@/components/ui/card";
import { Input as ShadcnInput } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const variantClass = {
  primary: "bg-primary text-primary-foreground shadow-[0_0_24px_rgba(206,0,55,0.28)] hover:bg-primary/90",
  secondary: "border-border bg-card text-foreground hover:bg-muted",
  ghost: "text-foreground hover:bg-muted",
  danger: "border border-destructive bg-transparent text-foreground hover:bg-destructive/10",
} as const;

const shadcnVariant = {
  primary: "default",
  secondary: "outline",
  ghost: "ghost",
  danger: "outline",
} as const;

function buttonClass(variant: keyof typeof variantClass) {
  return cn(
    "inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-4 py-2 text-base font-semibold transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-60",
    variantClass[variant],
  );
}

export function Button({
  className,
  variant = "primary",
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: keyof typeof variantClass }) {
  return (
    <ShadcnButton
      variant={shadcnVariant[variant]}
      type={type}
      className={cn(buttonClass(variant), "h-auto", className)}
      {...props}
    />
  );
}

export function TextLink({
  href,
  children,
  variant = "secondary",
  className,
}: {
  href: string;
  children: ReactNode;
  variant?: "primary" | "secondary" | "ghost";
  className?: string;
}) {
  return (
    <Link href={href} className={cn(buttonClass(variant), className)}>
      {children}
    </Link>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="block text-sm font-semibold text-foreground">{label}</span>
      {children}
      {hint ? <span className="block text-sm text-muted-foreground">{hint}</span> : null}
    </label>
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <ShadcnInput {...props} className={cn("h-11 rounded-2xl border-line bg-field px-3 text-base text-ink md:text-base", props.className)} />;
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <Textarea {...props} className={cn("min-h-32 text-base md:text-base", props.className)} />;
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <ShadcnCard className={cn("gap-0 rounded-3xl bg-card py-5 text-card-foreground shadow-sm ring-border", className)}>
      <CardContent className="px-5">{children}</CardContent>
    </ShadcnCard>
  );
}

const badgeTone = {
  neutral: "border-border bg-transparent text-muted-foreground",
  draft: "border-border bg-transparent text-foreground",
  active: "border-transparent bg-primary text-primary-foreground",
  archived: "border-border bg-transparent text-muted-foreground",
  pending: "border-primary bg-transparent text-foreground",
  good: "border-transparent bg-primary text-primary-foreground",
  bad: "border-destructive bg-transparent text-foreground",
  auto: "border-border bg-transparent text-foreground",
} as const;

export function Badge({
  tone = "neutral",
  children,
}: {
  tone?: keyof typeof badgeTone;
  children: ReactNode;
}) {
  return (
    <ShadcnBadge variant="outline" className={cn("h-auto rounded-full px-2.5 py-1 text-xs font-semibold", badgeTone[tone])}>
      {children}
    </ShadcnBadge>
  );
}

export { Select } from "@/components/pulse/select-field";
export { Banner } from "@/components/pulse/banner";
