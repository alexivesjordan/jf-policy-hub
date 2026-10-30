"use client";

import { useActionState } from "react";
import { createCategory, inviteUser, setAutoApply, updateUser } from "@/features/admin/actions";
import { Banner, Button, Field, Input, Select } from "@/components/ui";
import { roleLabel } from "@/lib/format";
import type { Category, Profile } from "@/lib/types";

export function InviteForm() {
  const [state, action, pending] = useActionState(inviteUser, null);
  return (
    <form action={action} className="grid gap-4 md:grid-cols-4">
      <Field label="Name">
        <Input name="fullName" />
      </Field>
      <Field label="Email">
        <Input name="email" type="email" required />
      </Field>
      <Field label="Role">
        <Select name="role" defaultValue="staff">
          <option value="staff">Staff</option>
          <option value="approver">Approver</option>
          <option value="admin">Administrator</option>
        </Select>
      </Field>
      <div className="flex items-end">
        <Button type="submit" disabled={pending}>
          {pending ? "Sending..." : "Send invite"}
        </Button>
      </div>
      {state ? (
        <div className="md:col-span-4">
          <Banner tone={state.ok ? "success" : "error"}>{state.message}</Banner>
        </div>
      ) : null}
    </form>
  );
}

export function PersonForm({ person }: { person: Profile }) {
  const [state, action, pending] = useActionState(updateUser, null);
  return (
    <form action={action} className="grid gap-3 border-t border-line py-4 md:grid-cols-[1.4fr_1fr_1fr_auto] md:items-end">
      <input type="hidden" name="userId" value={person.id} />
      <div>
        <p className="font-semibold">{person.full_name || person.email}</p>
        <p className="text-sm text-ink/70">{person.email}</p>
      </div>
      <Field label="Role">
        <Select name="role" defaultValue={person.role}>
          <option value="staff">Staff</option>
          <option value="approver">Approver</option>
          <option value="admin">Administrator</option>
        </Select>
      </Field>
      <Field label="Access">
        <Select name="isActive" defaultValue={person.is_active ? "yes" : "no"}>
          <option value="yes">Active</option>
          <option value="no">Deactivated</option>
        </Select>
      </Field>
      <Button type="submit" variant="secondary" disabled={pending}>
        {pending ? "Saving..." : "Save"}
      </Button>
      {state ? (
        <div className="md:col-span-4">
          <Banner tone={state.ok ? "success" : "error"}>{state.message}</Banner>
        </div>
      ) : null}
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
