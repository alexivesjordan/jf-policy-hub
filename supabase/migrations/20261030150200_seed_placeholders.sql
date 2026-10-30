-- Blank UK HR and health & safety placeholders.
-- Titles and categories only: empty text, draft status, no source file.
-- Version 1 records that the row is a placeholder so later uploads have history.

insert into public.categories (name, slug, auto_apply_allowed)
values
  ('HR', 'hr', false),
  ('Health & Safety', 'health-safety', false),
  ('Other', 'other', false);

with inserted as (
  insert into public.policies (title, category_id, status, current_content)
  select item.title, categories.id, 'draft', ''
  from (
    values
      ('Annual Leave', 'hr', 1),
      ('Sickness Absence', 'hr', 2),
      ('Disciplinary', 'hr', 3),
      ('Grievance', 'hr', 4),
      ('Equal Opportunities', 'hr', 5),
      ('Anti-Harassment & Bullying', 'hr', 6),
      ('Flexible Working', 'hr', 7),
      ('Maternity/Paternity/Shared Parental Leave', 'hr', 8),
      ('Data Protection (Employees)', 'hr', 9),
      ('Whistleblowing', 'hr', 10),
      ('Health & Safety Policy Statement', 'health-safety', 11),
      ('Fire Safety', 'health-safety', 12),
      ('First Aid', 'health-safety', 13),
      ('Risk Assessment', 'health-safety', 14),
      ('Manual Handling', 'health-safety', 15),
      ('Lone Working', 'health-safety', 16)
  ) as item(title, slug, sort)
  join public.categories on categories.slug = item.slug
  order by item.sort
  returning id, title
)
insert into public.policy_versions (
  policy_id,
  version_number,
  content,
  change_summary,
  reason
)
select
  id,
  1,
  '',
  'Placeholder created',
  'Blank policy ready for a document upload or to be written in the editor.'
from inserted;

insert into public.audit_log (actor_id, action, entity_type, entity_id, policy_id, details)
select
  null,
  'policy.created',
  'policy',
  policies.id,
  policies.id,
  jsonb_build_object('seed', true, 'title', policies.title, 'placeholder', true)
from public.policies;
