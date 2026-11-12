"use client";

import { isValidElement, useEffect, useRef, type ReactNode } from "react";
import { AlertCircle, CheckCircle2, Info, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

let lastAnnounced = "";

function plainText(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(plainText).join(" ");
  if (isValidElement(node)) return plainText((node.props as { children?: ReactNode }).children);
  return "";
}

function announce(tone: "success" | "error" | "warning", message: string) {
  const key = `${tone}:${message}`;
  if (lastAnnounced === key) return;
  lastAnnounced = key;
  if (tone === "success") toast.success(message);
  else if (tone === "error") toast.error(message);
  else toast.warning(message);
}

export function Banner({
  tone = "info",
  title,
  children,
}: {
  tone?: "info" | "success" | "warning" | "error";
  title?: string;
  children: ReactNode;
}) {
  const message = plainText(children).replace(/\s+/g, " ").trim();
  const seen = useRef<string | null>(null);

  useEffect(() => {
    if (!message || tone === "info") return;
    const key = `${tone}:${message}`;
    if (seen.current === key) return;
    seen.current = key;
    announce(tone, message);
  }, [message, tone]);

  const icon =
    tone === "success" ? (
      <CheckCircle2 className="mt-0.5 size-4 text-primary" aria-hidden="true" />
    ) : tone === "warning" ? (
      <TriangleAlert className="mt-0.5 size-4 text-primary" aria-hidden="true" />
    ) : tone === "error" ? (
      <AlertCircle className="mt-0.5 size-4 text-destructive" aria-hidden="true" />
    ) : (
      <Info className="mt-0.5 size-4 text-muted-foreground" aria-hidden="true" />
    );

  return (
    <Alert variant={tone === "error" ? "destructive" : "default"} role={tone === "error" ? "alert" : "status"}>
      {icon}
      <div>
        {title ? <AlertTitle>{title}</AlertTitle> : null}
        <AlertDescription className="text-foreground">{children}</AlertDescription>
      </div>
    </Alert>
  );
}
