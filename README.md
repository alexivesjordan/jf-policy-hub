# Jordan Orbit

AI operations and automation platform for Jordan Fitness. It is not a customer-facing site.

The live modules are **Orbit People** (HR and compliance) and the **Orbit Operations** install office (jobs, pricing, tasks, and notifications, without Cin7). The home screen also lists Orbit Service, Orbit Supply, Orbit Sales, and Orbit Finance. Those four show a coming-soon state until their own routes are added.

## Modules

Modules are registered in `src/modules/registry.ts`. Each entry has a name, tagline, icon, status, and the paths it owns. To add a module:

1. Add an entry to `orbitModules`. Use `status: "coming-soon"` until the screens exist.
2. When it is ready, set `status: "active"`, point `href` at its home route, list its `paths` and `nav`, and add the routes under `src/app`.
3. The sidebar reads the registry, so a new active module does not need a separate navigation component.

Orbit People keeps the existing policy routes (`/dashboard`, `/policies`, `/amendments`, `/notifications`, `/admin`).

Production deploys from `main` on Vercel. The four environment variables must be set on the Vercel project before a build. `NEXT_PUBLIC_*` values are read at build time.

## What v1 includes

- Email and password sign-in. Public registration is off. Forgot password sets a first password or replaces one.
- Administrators invite `@jordanfitness.com` addresses, change roles, deactivate accounts, and switch the Orbit People licence.
- `alex.ives@jordanfitness.com` stays an administrator (database trigger). Roles are administrator, editor/HR, and staff.
- Policy library with category, owner, status, review date, editable text, and an optional PDF or Word file.
- Blank draft placeholders for a typical UK HR and health & safety set, so the library is not empty.
- Every save and every upload creates an immutable version, with a side-by-side diff.
- Audit log of creates, edits, approvals, rejections, and automatic applies.
- Suggestion queue. Approvers can approve, edit then approve, or reject with a comment.
- Per-category **automatic updates** switch, off by default. When it is on, low-severity suggestions are applied and approvers are notified.
- Research-agent API for reading active policies and submitting suggestions.
- In-app notifications. Email is left as a single hook for later.
- Home page with waiting suggestions, policies due for review, and recent changes.

## Stack

- Next.js (App Router) and TypeScript
- Tailwind CSS
- Supabase Postgres, Auth, and Storage, with Row Level Security on every table
- Versioned SQL in `supabase/migrations`

## Project layout

Features are grouped so another business area can be added as its own module.

```
src/modules/registry.ts   module list, paths, and navigation
src/app/                  launcher, sign-in, and module routes
src/features/policies/    Orbit People policy reads, saves, uploads, Word text extraction
src/features/amendments/  suggestions and the agent payload check
src/features/notifications/  in-app delivery and the email hook
src/features/admin/       invites, roles, module licences, categories
src/features/auth/        sign-in, password reset, sign-out
src/components/           shared screens
src/lib/                  Supabase clients, formatting, diff
supabase/migrations/      schema, RLS, storage bucket, placeholder seed
```

To add a later area, register it in `src/modules/registry.ts`, add its routes, and add a migration if it needs tables. Do not reuse the policy tables for unrelated records.

## Local setup

1. Install dependencies:

```bash
npm install
```

2. Copy the environment file and fill in the four values from the Supabase project settings (Project Settings → API):

```bash
cp .env.example .env.local
```

| Name | Where it is used |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Browser and server. Must be present at build time. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser and server, protected by RLS. Must be present at build time. |
| `SUPABASE_SERVICE_ROLE_KEY` | Server only. Invites and the research-agent API. Never expose it to the browser. |
| `RESEARCH_AGENT_TOKEN` | Server only. Bearer token for `POST /api/amendments` and `GET /api/policies`. Use a long random string. |

3. Apply the migrations (next section), then set the Authentication values in [Sign-in settings](#sign-in-settings).

4. Start the app:

```bash
npm run dev
```

5. If `alex.ives@jordanfitness.com` does not exist yet, add that user in the Supabase dashboard (Authentication → Users → Add user) and mark the email confirmed. The database makes that address an administrator. Then open `http://localhost:3000/login/forgot` and set a password. Invite everyone else from **Users**.

`supabase/config.toml` is set up for the Supabase CLI (`supabase start` / `supabase db reset` locally). Local email is caught by Inbucket when you use the CLI stack. Public sign-up is off there as well.

## Sign-in settings

Apply these on the hosted project after migration `20261102160000_access_control.sql`. The app does not configure the provider for you.

Authentication → Sign In / Providers (the labels are “Allow new users to sign up” and the Email provider):

| Setting | Value |
| --- | --- |
| Allow new users to sign up | Off. Invites use the service role and still work. |
| Email provider | On. |
| Confirm email | On. The invite link confirms the address. |
| Secure password change | Off, so Change password in the user menu does not ask for a second email. |
| Minimum password length | 8. Leave the extra character-class rule empty. |
| Azure / Microsoft | Leave disabled. Sign-in is email and password. |

Authentication → URL configuration:

| Setting | Value |
| --- | --- |
| Site URL | `https://jf-policy-hub.vercel.app` with no trailing slash. Use `http://localhost:3000` only on a local project. |
| Redirect URLs | `https://jf-policy-hub.vercel.app/auth/callback`, `https://jf-policy-hub.vercel.app/auth/confirm`, `http://localhost:3000/auth/callback`, `http://localhost:3000/auth/confirm`. A wildcard `https://jf-policy-hub.vercel.app/**` is fine as well. |

Authentication → Emails → Templates. Leave the defaults in place. On the free tier, Supabase refuses template edits while it is still sending mail itself. The default invite and reset emails are enough: both land on `/auth/confirm`, then on the set-password page.

`supabase/templates/invite.html` and `supabase/templates/recovery.html` are for later, after custom SMTP is switched on and template edits are allowed. Those links use `token_hash`, and `/auth/confirm` accepts that as well as the default redirect shapes.

`alex.ives@jordanfitness.com` already has an account and no password. Forgot password is the way to set one. Do not turn public sign-up back on to do that.

Someone who is not invited can still end up with an auth user if they are added in the dashboard. The app shows “No access yet” until an administrator invites that `@jordanfitness.com` address. Any other domain never receives access.

Later, when DNS for the sending domain is verified, point Supabase at Resend under Authentication → Emails → SMTP:

- Host `smtp.resend.com`, port `465` (or `587`)
- Username `resend`, password the Resend API key
- Sender name `Jordan Orbit`, sender email an address on the verified domain

Until that is on, Supabase’s own mailer sends the invite and reset emails. No application code change is required for the switch.

## Migrations

SQL lives in `supabase/migrations` and is applied in filename order:

1. `20261030150000_schema.sql` — tables, immutability, auth trigger, version and review functions
2. `20261030150100_rls_storage.sql` — row level security and the private `policy-documents` bucket
3. `20261030150200_seed_placeholders.sql` — HR and health & safety drafts with empty text
4. `20261030170000_fill_empty_policy_text.sql` — fill an empty version from an attached PDF or Word file
5. `20261102160000_access_control.sql` — invite-only access, `@jordanfitness.com`, module licences, last sign-in
6. `20261105120000_orbit_core.sql` — shared Core schema (workflow, audit, tasks, notifications, settings, files, gate overrides, tokens)
7. `20261105120100_ops_installs.sql` — Operations / Installs tables, status protection, and the manual on-hold / lost stub

Apply 6 and 7 on a **preview** Supabase project first. Do not run them on the production People project until the Orbit Core pull request has been reviewed. They do not rewrite the People tables. A trigger on `public.profiles` gives `alex.ives@jordanfitness.com` the Operations module and the named owner role. `public.audit_log` and `public.notifications` stay as they are; Core adds `core.audit_log` and `core.notifications` beside them.

There is no Cin7 connection in these migrations. Customer segment, customer type, and quote/order numbers are stored as empty columns until that integration is specified.

`supabase/config.toml` exposes the `core` and `ops` schemas for the local CLI. On a hosted preview project, add those same names under Project Settings → API → Exposed schemas before querying the tables directly. The M0 routes call `public` functions, so they work before that setting is changed.

Hosted preview project, Supabase CLI (link the preview ref, not production):

```bash
npx supabase login
npx supabase link --project-ref <project-ref>
npx supabase db push
```

Management API or SQL editor: run the files in that order, once. Do not edit a migration that has already been applied. Add a new file instead.

The seed creates these drafts (empty text, no file):

- HR: Annual Leave, Sickness Absence, Disciplinary, Grievance, Equal Opportunities, Anti-Harassment & Bullying, Flexible Working, Maternity/Paternity/Shared Parental Leave, Data Protection (Employees), Whistleblowing
- Health & Safety: Health & Safety Policy Statement, Fire Safety, First Aid, Risk Assessment, Manual Handling, Lone Working
- Category **Other** is included so more policies can be filed without a migration

Each placeholder has version 1, “Placeholder created”, so the first real upload becomes version 2.

## Uploading a policy

**Policies → Upload a policy document**, or **Upload** on a placeholder.

- `.docx` and text-based `.pdf`: the text is extracted into the policy, keeping headings, paragraphs and lists where the file has them. The original file is stored, and a new version is saved.
- A scanned PDF with no text layer is refused. Paste the wording with Edit text instead.
- Older `.doc` files are refused. Save them as `.docx` first.
- Files larger than 10 MB are refused.
- Every draft and active policy can take a new file, including one that already has a document. If it already has text, confirm before the new file replaces it.
- A policy page with an attached file and empty text has **Read text from the attached file**. That fills the empty version. From the command line, after migration `20261030170000_fill_empty_policy_text.sql`:

```bash
NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
  npx tsx scripts/backfill-policy-text.ts 1452efac-98ce-4129-9cd6-48ce93a62ec4
```

That id is the Modern Slavery & Human Trafficking policy.
- Leave “ready for people to follow” unticked to keep the policy as a draft while you check the wording.

Direct edits in **Edit text** also create a version. Ask for a short “What changed?” note so the history stays readable.

## Roles

| Role | Can do |
| --- | --- |
| Staff | Read policies, upload and edit text, send suggestions, see their notifications, when Orbit People is on |
| Editor / HR | Everything staff can do, plus approve, edit-then-approve, or reject suggestions. Stored as `approver`. |
| Administrator | Everything an editor can do, plus Users, roles, deactivation, module licences, and categories. Administrators can open Orbit People even if that licence is off. |

Deactivated people keep their history but cannot open the app. You cannot deactivate yourself or remove the last active administrator. `alex.ives@jordanfitness.com` cannot be given another role.

An invite writes `user.invited`. A role change writes `user.role_changed`. Deactivating or switching someone back on writes `user.deactivated` or `user.reactivated`. A People licence change writes `user.module_changed`. The database enforces this, not only the Users screen. The service role is used on the server to send the invite email and is not available in the browser.

## Suggestions and automatic updates

Anyone signed in can suggest a change from a policy. The research agent uses the API below. `created_by` is `user` or `research agent`.

Approvers open **Suggestions**, compare the current policy with the proposal, and either:

- approve it (optionally after editing the text), which writes a new policy version, or
- reject it with a comment.

**Categories** has an “automatic updates” switch per category. It defaults to off. When it is on, a **low** severity suggestion is applied immediately, marked `auto-applied`, written to the audit log, and shown to approvers and administrators. Medium and high suggestions still wait.

## Notifications and email

New suggestions and automatic applies create an in-app notification for every active approver and administrator. The list is **Notifications**.

Email is intentionally not sent. The only place to add it is `src/features/notifications/email.ts` (`deliverEmailNotification`). Callers already pass the recipient, title, body, and link. Keep that function from throwing, so a mail outage does not undo a review.

## Research agent API

Both routes require:

```
Authorization: Bearer <RESEARCH_AGENT_TOKEN>
Content-Type: application/json
```

The token is compared in constant time. A missing or wrong token returns `401`. The service role key is not accepted as a substitute on these routes.

### `GET /api/policies`

Returns active policies only, for comparison. Draft placeholders are not included.

```bash
curl -s https://<your-app>/api/policies \
  -H "Authorization: Bearer $RESEARCH_AGENT_TOKEN"
```

```json
{
  "policies": [
    {
      "id": "uuid",
      "title": "Annual Leave",
      "status": "active",
      "category": "HR",
      "category_slug": "hr",
      "content": "# Annual leave\n...",
      "review_date": "2027-04-01",
      "updated_at": "2026-10-30T12:00:00+00:00"
    }
  ]
}
```

### `POST /api/amendments`

Submits one suggestion. If that policy’s category allows automatic updates and `severity` is `low`, the suggestion is applied and the response status is `auto-applied` (HTTP 201). Otherwise it stays `pending` (HTTP 202) and approvers are notified.

```bash
curl -s -X POST https://<your-app>/api/amendments \
  -H "Authorization: Bearer $RESEARCH_AGENT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "policy_id": "uuid-of-an-existing-policy",
    "proposed_content": "Full proposed policy text",
    "summary": "Update carry-over wording for the new tax year",
    "legal_change_description": "What changed in the law or guidance",
    "source_urls": ["https://www.gov.uk/holiday-entitlement-rights"],
    "jurisdiction": "England and Wales",
    "effective_date": "2027-04-01",
    "severity": "low"
  }'
```

| Field | Required | Notes |
| --- | --- | --- |
| `policy_id` | yes | UUID of a draft or active policy. Archived policies are rejected. |
| `proposed_content` | yes | Full text that would replace the current policy text. |
| `summary` | yes | Short note stored on the version if it is applied. |
| `legal_change_description` | no | Shown to the approver and stored as the version reason. |
| `source_urls` | no | Up to 20 links. |
| `jurisdiction` | no | For example `England and Wales`. |
| `effective_date` | no | `YYYY-MM-DD` or null. |
| `severity` | yes | `low`, `medium`, or `high`. |

Success:

```json
{ "id": "uuid", "status": "pending", "policy_id": "uuid" }
```

`status` is `pending`, or `auto-applied` when the category switch is on and severity is low. Validation errors return `400` with an `error` string. An unknown policy returns `404`.

## Deploy on Vercel

Do this when you want the app live. It is not done from this repository automatically.

1. Apply the migrations to the production Supabase project.
2. Create a Vercel project from this repo. Framework preset: Next.js. Do not change the build command (`next build`).
3. Set the four environment variables from `.env.example` for Production (and Preview, if you want preview databases separated).
4. In Supabase Authentication, apply the [sign-in settings](#sign-in-settings), including the production Site URL and redirect URLs.
5. Deploy. `NEXT_PUBLIC_*` values are baked in at build time, so change them and redeploy if the Supabase URL changes.

## Scripts

```bash
npm run dev
npm run lint
npm run build
```
