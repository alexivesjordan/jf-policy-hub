import Link from "next/link";
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function buttonClass(variant: "primary" | "secondary" | "ghost" | "danger" = "primary") {
  return cn(
    "inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-4 py-2 text-base font-semibold transition disabled:cursor-not-allowed disabled:opacity-60",
    variant === "primary" && "bg-yellow text-[#0D0D0D] shadow-[0_0_24px_rgba(255,197,2,0.18)] hover:bg-clay-dark",
    variant === "secondary" && "border border-line bg-card text-ink hover:border-yellow/50 hover:bg-white/5",
    variant === "ghost" && "text-ink hover:bg-white/10",
    variant === "danger" && "bg-danger text-white hover:brightness-110",
  );
}

export function Button({
  className,
  variant = "primary",
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger" }) {
  return <button type={type} className={cn(buttonClass(variant), className)} {...props} />;
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
      <span className="block text-sm font-semibold text-ink">{label}</span>
      {children}
      {hint ? <span className="block text-sm text-ink/70">{hint}</span> : null}
    </label>
  );
}

const controlClass =
  "w-full rounded-2xl border border-line bg-field px-3 py-2.5 text-base text-ink outline-none ring-yellow transition focus:border-yellow focus:ring-2 focus:shadow-[0_0_0_4px_rgba(255,197,2,0.15)]";

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn(controlClass, props.className)} />;
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cn(controlClass, "min-h-32", props.className)} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cn(controlClass, props.className)} />;
}

export function Banner({
  tone = "info",
  children,
}: {
  tone?: "info" | "success" | "warning" | "error";
  children: ReactNode;
}) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "rounded-2xl border px-4 py-3 text-sm leading-6",
        tone === "info" && "border-line bg-mist text-ink",
        tone === "success" && "border-moss/30 bg-moss/10 text-moss",
        tone === "warning" && "border-amber/30 bg-amber/10 text-amber",
        tone === "error" && "border-rose/30 bg-rose/10 text-rose",
      )}
    >
      {children}
    </div>
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <section className={cn("rounded-3xl border border-line bg-card p-5 shadow-sm", className)}>{children}</section>;
}

export function Badge({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "draft" | "active" | "archived" | "pending" | "good" | "bad" | "auto";
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold",
        tone === "neutral" && "bg-field/10 text-ink",
        tone === "draft" && "bg-yellow/15 text-yellow",
        tone === "active" && "bg-yellow/15 text-yellow",
        tone === "archived" && "bg-field/10 text-white/60",
        tone === "pending" && "bg-yellow/15 text-yellow",
        tone === "good" && "bg-yellow/15 text-yellow",
        tone === "bad" && "bg-danger/20 text-rose",
        tone === "auto" && "bg-field/10 text-yellow",
      )}
    >
      {children}
    </span>
  );
}
