"use client";

import { useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/pulse/page-header";
import { Button, Input } from "@/components/pulse/ui";

export default function OpenCasePage() {
  const [route, setRoute] = useState("manager");
  return (
    <form
      className="mx-auto max-w-lg space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        toast.success("Case opened");
      }}
    >
      <PageHeader eyebrow="Jordan Pulse" title="Open a case" />
      <label className="block text-sm font-semibold">
        Type
        <select className="mt-1 h-11 w-full rounded-2xl border border-line bg-field px-3" aria-label="Type" name="type">
          <option value="disciplinary">Disciplinary</option>
          <option value="grievance">Grievance</option>
          <option value="performance">Performance</option>
          <option value="health">Health</option>
          <option value="flexible_working">Flexible working</option>
        </select>
      </label>
      <label className="block text-sm font-semibold">
        Subject
        <Input className="mt-1" name="subject" aria-label="Subject" placeholder="Name" required />
      </label>
      <label className="block text-sm font-semibold">
        Title
        <Input className="mt-1" name="title" aria-label="Title" required />
      </label>
      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold">Route</legend>
        <label className="flex min-h-11 items-center gap-2 text-sm"><input type="radio" name="route" checked={route === "manager"} onChange={() => setRoute("manager")} /> Manager</label>
        <label className="flex min-h-11 items-center gap-2 text-sm"><input type="radio" name="route" checked={route === "director_only"} onChange={() => setRoute("director_only")} /> Director only</label>
      </fieldset>
      <Button type="submit">Open</Button>
    </form>
  );
}
