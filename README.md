# Policy Hub

Internal policy library for Jordan Fitness. Staff can read policies, HR can upload or write them, and approvers can accept or reject suggested changes. It is not a customer-facing site.

The app is ready to deploy on Vercel. This repository does not deploy it. Apply the database migrations and set the environment variables, then connect the repo in Vercel when you are ready.

## What v1 includes

- Email magic link and password sign-in. Roles are administrator, approver, and staff.
- Administrators invite people, change roles, and deactivate accounts.
- The first sign-up for `alex.ives@jordanfitness.com` becomes an administrator (database trigger).
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

Features are grouped so another business area can be added without folding it into the policy code.

```
src/app/                  routes, including /api for the research agent
src/features/policies/    policy reads, saves, uploads, Word text extraction
src/features/amendments/  suggestions and the agent payload check
src/features/notifications/  in-app delivery and the email hook
src/features/admin/       invites, roles, categories
src/features/auth/        sign-out
src/components/           shared screens
src/lib/                  Supabase clients, formatting, diff
supabase/migrations/      schema, RLS, storage bucket, placeholder seed
```

To add a later area, create `src/features/<area>/`, add routes under `src/app/(app)/`, and add a new migration. Do not reuse policy tables for unrelated records.

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

3. In the Supabase dashboard, under Authentication → URL configuration, set:

- Site URL: `http://localhost:3000` locally, and the Vercel URL in production
- Redirect URLs: `http://localhost:3000/auth/callback` and `https://<your-app>/auth/callback`

4. Enable the Email provider. Magic link and password both use it. For local experiments you can turn off “Confirm email” so the first account can sign in immediately. Production should keep confirmation on.

5. Apply the migrations (next section), then:

```bash
npm run dev
```

6. Open `http://localhost:3000` and create the account `alex.ives@jordanfitness.com`. That address is stored as administrator. Invite everyone else from **People**. New accounts start as staff unless you pick another role on the invite.

`supabase/config.toml` is set up for the Supabase CLI (`supabase start` / `supabase db reset` locally). Local email is caught by Inbucket when you use the CLI stack.

## Migrations

SQL lives in `supabase/migrations` and is applied in filename order:

1. `20261030150000_schema.sql` — tables, immutability, auth trigger, version and review functions
2. `20261030150100_rls_storage.sql` — row level security and the private `policy-documents` bucket
3. `20261030150200_seed_placeholders.sql` — HR and health & safety drafts with empty text

Hosted project, Supabase CLI:

```bash
npx supabase login
npx supabase link --project-ref <project-ref>
npx supabase db push
```

Management API or SQL editor: run the three files in that order, once. Do not edit a migration that has already been applied. Add a new file instead.

The seed creates these drafts (empty text, no file):

- HR: Annual Leave, Sickness Absence, Disciplinary, Grievance, Equal Opportunities, Anti-Harassment & Bullying, Flexible Working, Maternity/Paternity/Shared Parental Leave, Data Protection (Employees), Whistleblowing
- Health & Safety: Health & Safety Policy Statement, Fire Safety, First Aid, Risk Assessment, Manual Handling, Lone Working
- Category **Other** is included so more policies can be filed without a migration

Each placeholder has version 1, “Placeholder created”, so the first real upload becomes version 2.

## Uploading a policy

**Policies → Upload a policy document**, or **Upload** on a placeholder.

- `.docx`: the text is extracted into the policy, the original file is stored, and a new version is saved. You can then edit the text.
- `.pdf`: the file is stored and a new version is saved. PDF text is not extracted. You can still type an editable copy.
- Older `.doc` files are refused. Save them as `.docx` first.
- Files larger than 10 MB are refused.
- If the policy already has text, a Word upload asks you to confirm before replacing it.
- Leave “ready for people to follow” unticked to keep the policy as a draft while you check the wording.

Direct edits in **Edit text** also create a version. Ask for a short “What changed?” note so the history stays readable.

## Roles

| Role | Can do |
| --- | --- |
| Staff | Read policies, upload and edit text, send suggestions, see their notifications |
| Approver | Everything staff can do, plus approve, edit-then-approve, or reject suggestions |
| Administrator | Everything an approver can do, plus invites, roles, deactivation, and categories |

Deactivated people keep their history but cannot open the app. You cannot deactivate yourself or remove the last active administrator.

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
4. In Supabase Authentication → URL configuration, add the Vercel URL and `https://<your-domain>/auth/callback`.
5. Deploy. `NEXT_PUBLIC_*` values are baked in at build time, so change them and redeploy if the Supabase URL changes.

## Scripts

```bash
npm run dev
npm run lint
npm run build
```
