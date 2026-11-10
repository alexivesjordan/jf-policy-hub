"use client";

import Link from "next/link";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export function StatusTabs({
  label,
  value,
  tabs,
}: {
  label: string;
  value: string;
  tabs: { value: string; label: string; href: string }[];
}) {
  return (
    <Tabs value={value || "all"}>
      <TabsList aria-label={label}>
        {tabs.map((tab) => (
          <TabsTrigger key={tab.href} value={tab.value || "all"} nativeButton={false} render={<Link href={tab.href} />}>
            {tab.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
