"use client";

import type { ReactNode } from "react";
import { Settings } from "lucide-react";
import { Button } from "@/components/pulse/ui";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

export function QuoteSettingsButton({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <Dialog>
      <DialogTrigger render={<Button variant="secondary" aria-label="Settings" />}>
        <Settings />
        <span className="sr-only">Settings</span>
      </DialogTrigger>
      <DialogContent className="max-h-[min(85vh,52rem)] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl">{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-8">{children}</div>
      </DialogContent>
    </Dialog>
  );
}
