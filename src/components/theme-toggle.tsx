"use client";

import { useEffect, useState } from "react";

const storageKey = "pulse-theme";

export function ThemeToggle() {
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    setTheme(document.documentElement.dataset.theme === "dark" ? "dark" : "light");
  }, []);

  function apply(next: "light" | "dark") {
    document.documentElement.dataset.theme = next;
    localStorage.setItem(storageKey, next);
    document.cookie = `${storageKey}=${next}; Path=/; Max-Age=31536000; SameSite=Lax`;
    setTheme(next);
  }

  const next = theme === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      onClick={() => apply(next)}
      className="inline-flex min-h-11 items-center rounded-full border border-line px-3 text-sm font-semibold text-ink"
      aria-pressed={theme === "dark"}
    >
      {theme === "dark" ? "Light mode" : "Dark mode"}
    </button>
  );
}
