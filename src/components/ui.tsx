import Link from "next/link";
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function buttonClass(variant: "primary" | "secondary" | "ghost" | "danger" = "primary") {
  return cn(
    "inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-4 py-2 text-base font-semibold transition disabled:cursor-not-allowed disabled:opacity-60",
    variant === "primary" && "bg-red text-white shadow-[0_0_24px_rgba(206,0,55,0.28)] hover:bg-red-deep",
    variant === "secondary" && "border border-line bg-card text-white hover:border-white/40 hover:bg-white/5",
    variant === "ghost" && "text-white hover:bg-white/10",
    variant === "danger" && "border border-red-deep bg-transparent text-white hover:bg-red-deep/30",
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
      {hint ? <span className="block text-sm text-grey">{hint}</span> : null}
    </label>
  );
}

const controlClass =
  "w-full rounded-2xl border border-line bg-field px-3 py-2.5 text-base text-white outline-none ring-red transition focus:border-red focus:ring-2 focus:shadow-[0_0_0_4px_rgba(206,0,55,0.28)]";

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
        tone === "info" && "border-line bg-card text-white",
        tone === "success" && "border-line bg-card text-white",
        tone === "warning" && "border-line bg-card text-white",
        tone === "error" && "border-red bg-card text-white",
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
        tone === "neutral" && "border border-line bg-transparent text-grey",
        tone === "draft" && "border border-line bg-transparent text-white",
        tone === "active" && "bg-red text-white",
        tone === "archived" && "border border-line bg-transparent text-grey",
        tone === "pending" && "border border-red bg-transparent text-white",
        tone === "good" && "bg-red text-white",
        tone === "bad" && "border border-red-deep bg-transparent text-white",
        tone === "auto" && "border border-line bg-transparent text-white",
      )}
    >
      {children}
    </span>
  );
}
