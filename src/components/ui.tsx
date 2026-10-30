import Link from "next/link";
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function buttonClass(variant: "primary" | "secondary" | "ghost" | "danger" = "primary") {
  return cn(
    "inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-4 py-2 text-base font-semibold transition disabled:cursor-not-allowed disabled:opacity-60",
    variant === "primary" && "bg-clay text-white hover:bg-clay-dark",
    variant === "secondary" && "border border-line bg-card text-ink hover:bg-white",
    variant === "ghost" && "text-ink hover:bg-white",
    variant === "danger" && "bg-rose text-white hover:opacity-90",
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
  "w-full rounded-2xl border border-line bg-white px-3 py-2.5 text-base text-ink outline-none ring-pine focus:ring-2";

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
        tone === "neutral" && "bg-mist text-ink",
        tone === "draft" && "bg-amber/15 text-amber",
        tone === "active" && "bg-moss/15 text-moss",
        tone === "archived" && "bg-ink/10 text-ink/70",
        tone === "pending" && "bg-clay/15 text-clay-dark",
        tone === "good" && "bg-moss/15 text-moss",
        tone === "bad" && "bg-rose/10 text-rose",
        tone === "auto" && "bg-pine/10 text-pine",
      )}
    >
      {children}
    </span>
  );
}
