-- ACAS stages for HR cases, and the shorter flexible-working path.
-- New file only. Do not apply to production.

insert into core.workflow_definitions (module_id, name, entity_table)
values ('people', 'hr_case', 'hr.cases')
on conflict (module_id, name) do nothing;

insert into core.workflow_states (workflow_id, code, label, is_terminal, sort_order)
select d.id, s.code, s.label, s.terminal, s.ord
from core.workflow_definitions d
cross join (values
  ('raised', 'Raised', false, 1),
  ('investigation', 'Investigation', false, 2),
  ('meeting_invited', 'Meeting invited', false, 3),
  ('meeting_held', 'Meeting held', false, 4),
  ('outcome_sent', 'Outcome sent', false, 5),
  ('appeal', 'Appeal', false, 6),
  ('closed', 'Closed', true, 7)
) as s(code, label, terminal, ord)
where d.module_id = 'people' and d.name = 'hr_case'
on conflict (workflow_id, code) do nothing;

insert into core.workflow_transitions (workflow_id, from_state, to_state, event, is_manual)
select d.id, t.from_state, t.to_state, t.event, true
from core.workflow_definitions d
cross join (values
  ('raised', 'investigation', 'advance'),
  ('investigation', 'meeting_invited', 'advance'),
  ('meeting_invited', 'meeting_held', 'advance'),
  ('meeting_held', 'outcome_sent', 'advance'),
  ('outcome_sent', 'appeal', 'appeal'),
  ('outcome_sent', 'closed', 'close'),
  ('appeal', 'closed', 'close')
) as t(from_state, to_state, event)
where d.module_id = 'people' and d.name = 'hr_case'
on conflict (workflow_id, from_state, to_state, event) do nothing;

insert into core.workflow_definitions (module_id, name, entity_table)
values ('people', 'hr_flexible_working', 'hr.cases')
on conflict (module_id, name) do nothing;

insert into core.workflow_states (workflow_id, code, label, is_terminal, sort_order)
select d.id, s.code, s.label, s.terminal, s.ord
from core.workflow_definitions d
cross join (values
  ('requested', 'Requested', false, 1),
  ('meeting', 'Meeting', false, 2),
  ('decided', 'Decided', false, 3),
  ('appeal', 'Appeal', false, 4),
  ('closed', 'Closed', true, 5)
) as s(code, label, terminal, ord)
where d.module_id = 'people' and d.name = 'hr_flexible_working'
on conflict (workflow_id, code) do nothing;

insert into core.workflow_transitions (workflow_id, from_state, to_state, event, is_manual)
select d.id, t.from_state, t.to_state, t.event, true
from core.workflow_definitions d
cross join (values
  ('requested', 'meeting', 'advance'),
  ('meeting', 'decided', 'advance'),
  ('decided', 'appeal', 'appeal'),
  ('decided', 'closed', 'close'),
  ('appeal', 'closed', 'close')
) as t(from_state, to_state, event)
where d.module_id = 'people' and d.name = 'hr_flexible_working'
on conflict (workflow_id, from_state, to_state, event) do nothing;
