"use client";

import { useActionState } from "react";
import { createCategory, inviteUser, setAutoApply, updateUser } from "@/features/admin/actions";
import { Banner, Button, Field, Input, Select } from "@/components/ui";
import { formatTimestamp, memberStatus, roleLabel } from "@/lib/format";
import type { Category, DirectoryUser } from "@/lib/types";
import { orbitModules } from "@/modules/registry";

function RoleOptions() {
  return (
    <>
      <option value="staff">Staff</option>
      <option value="approver">Editor / HR</option>
      <option value="admin">Administrator</option>
    </>
  );
}

export function InviteForm() {
  const [state, action, pending] = useActionState(inviteUser, null);
  return (
    <form action={action} className="grid gap-4 md:grid-cols-4">
      <Field label="Name">
        <Input name="fullName" autoComplete="name" />
      </Field>
      <Field label="Email" hint="@jordanfitness.com">
        <Input name="email" type="email" autoComplete="off" required />
      </Field>
      <Field label="Role">
        <Select name="role" defaultValue="staff">
          <RoleOptions />
        </Select>
      </Field>
      <div className="flex items-end">
        <Button type="submit" disabled={pending}>
          {pending ? "Sending..." : "Send invite"}
        </Button>
      </div>
      <label className="flex min-h-11 items-center gap-3 text-sm font-semibold md:col-span-4">
        <input type="checkbox" name="peopleEnabled" value="yes" defaultChecked className="size-4 accent-[#ce0037]" />
        Orbit People licence
      </label>
      {state ? (
        <div className="md:col-span-4">
          <Banner tone={state.ok ? "success" : "error"}>{state.message}</Banner>
        </div>
      ) : null}
    </form>
  );
}

export function UserForm({ person }: { person: DirectoryUser }) {
  const [state, action, pending] = useActionState(updateUser, null);
  const peopleOn = person.modules.some((module) => module.module_id === "people" && module.enabled);
  const status = memberStatus(person);

  return (
    <form action={action} className="space-y-4 border-t border-line py-5">
      <input type="hidden" name="userId" value={person.id} />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-semibold">{person.full_name || person.email}</p>
          <p className="text-sm text-grey">{person.email}</p>
          <p className="mt-1 text-sm text-grey">
            Last sign-in: {person.last_sign_in_at ? formatTimestamp(person.last_sign_in_at) : "Never"}
          </p>
        </div>
        <span
          className={
            status === "Active"
              ? "rounded-full bg-red px-2.5 py-1 text-xs font-semibold text-white"
              : "rounded-full border border-line px-2.5 py-1 text-xs font-semibold text-grey"
          }
        >
          {status}
        </span>
      </div>
      <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
        <Field label="Role">
          <Select name="role" defaultValue={person.role} aria-label={`Role for ${person.email}`}>
            <RoleOptions />
          </Select>
        </Field>
        <Field label="Status">
          <Select name="isActive" defaultValue={person.is_active ? "yes" : "no"} aria-label={`Status for ${person.email}`}>
            <option value="yes">Active</option>
            <option value="no">Deactivated</option>
          </Select>
        </Field>
        <Button type="submit" variant="secondary" disabled={pending}>
          {pending ? "Saving..." : "Save"}
        </Button>
      </div>
      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold">Module licences</legend>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {orbitModules.map((module) => {
            const stored = person.modules.find((item) => item.module_id === module.id);
            if (module.id === "people") {
              return (
                <label key={module.id} className="flex min-h-11 items-center gap-3 rounded-2xl border border-line px-3 text-sm font-semibold">
                  <input
                    type="checkbox"
                    name="peopleEnabled"
                    value="yes"
                    defaultChecked={peopleOn}
                    className="size-4 accent-[#ce0037]"
                  />
                  People
                </label>
              );
            }
            return (
              <label key={module.id} className="flex min-h-11 items-center gap-3 rounded-2xl border border-line px-3 text-sm text-grey">
                <input type="checkbox" defaultChecked={stored?.enabled ?? false} disabled className="size-4" />
                {module.name.replace("Orbit ", "")}
                <span className="ml-auto text-xs">Coming soon</span>
              </label>
            );
          })}
        </div>
        <p className="text-sm text-grey">
          Administrators can always open Orbit People. The People switch applies to everyone else. Other modules are stored and stay off until they open.
        </p>
      </fieldset>
      {state ? <Banner tone={state.ok ? "success" : "error"}>{state.message}</Banner> : null}
      <p className="sr-only">{roleLabel(person.role)}</p>
    </form>
  );
}

export function CategoryForm() {
  const [state, action, pending] = useActionState(createCategory, null);
  return (
    <form action={action} className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <Field label="New category">
        <Input name="name" required placeholder="For example, Finance" />
      </Field>
      <Button type="submit" disabled={pending}>
        {pending ? "Adding..." : "Add category"}
      </Button>
      {state ? <Banner tone={state.ok ? "success" : "error"}>{state.message}</Banner> : null}
    </form>
  );
}

export function AutoApplyForm({ category }: { category: Category }) {
  const [state, action, pending] = useActionState(setAutoApply, null);
  const next = category.auto_apply_allowed ? "no" : "yes";
  return (
    <form action={action} className="space-y-3 rounded-3xl border border-line bg-card p-4">
      <input type="hidden" name="categoryId" value={category.id} />
      <input type="hidden" name="allowed" value={next} />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{category.name}</h2>
          <p className="mt-1 max-w-xl text-sm leading-6 text-ink/70">
            {category.auto_apply_allowed
              ? "Low-severity suggestions are applied on their own. Approvers are still notified."
              : "Every suggestion waits for a person to approve it. This is the safer default."}
          </p>
        </div>
        <Button type="submit" variant={category.auto_apply_allowed ? "secondary" : "primary"} disabled={pending}>
          {pending ? "Saving..." : category.auto_apply_allowed ? "Turn automatic updates off" : "Turn automatic updates on"}
        </Button>
      </div>
      {state ? <Banner tone={state.ok ? "success" : "error"}>{state.message}</Banner> : null}
    </form>
  );
}
