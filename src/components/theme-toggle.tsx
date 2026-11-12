"use client";

import { useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";

const storageKey = "pulse-theme";

function themeSnapshot() {
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

function subscribeTheme(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "class"] });
  return () => observer.disconnect();
}

export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribeTheme, themeSnapshot, () => "light" as const);

  function apply(next: "light" | "dark") {
    document.documentElement.dataset.theme = next;
    document.documentElement.classList.toggle("dark", next === "dark");
    localStorage.setItem(storageKey, next);
    document.cookie = `${storageKey}=${next}; Path=/; Max-Age=31536000; SameSite=Lax`;
  }

  const next = theme === "dark" ? "light" : "dark";
  const label = theme === "dark" ? "Switch to light mode" : "Switch to dark mode";
  return (
    <button
      type="button"
      onClick={() => apply(next)}
      className="inline-flex size-11 items-center justify-center rounded-full border border-line text-ink outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      aria-pressed={theme === "dark"}
      aria-label={label}
      title={label}
    >
      {theme === "dark" ? <Sun className="size-4" aria-hidden="true" /> : <Moon className="size-4" aria-hidden="true" />}
    </button>
  );
}
