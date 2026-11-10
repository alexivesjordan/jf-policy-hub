"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

const storageKey = "pulse-theme";

export function ThemeToggle() {
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    setTheme(document.documentElement.dataset.theme === "dark" ? "dark" : "light");
  }, []);

  function apply(next: "light" | "dark") {
    document.documentElement.dataset.theme = next;
    document.documentElement.classList.toggle("dark", next === "dark");
    localStorage.setItem(storageKey, next);
    document.cookie = `${storageKey}=${next}; Path=/; Max-Age=31536000; SameSite=Lax`;
    setTheme(next);
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
