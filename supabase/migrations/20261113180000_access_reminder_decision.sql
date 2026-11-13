-- Reminders stop when the form is submitted, with or without photos.
-- Existing installs are not emailed. Only a new booking sends an access form.

insert into core.settings (key, module_id, value, version, change_reason)
values (
  'installs.access_reminder_days',
  'operations',
  '{"weekly": true, "finalDaysBeforeStart": 7, "backfillMissingLinks": false}'::jsonb,
  4,
  'Reminders stop once the form is submitted. Existing installs are not emailed.'
);

create or replace function public.install_access_reminder_queue()
returns jsonb
language plpgsql
stable
security definer
set search_path = ops, core, public
as $$
declare
  v_settings jsonb;
begin
  if coalesce(auth.role(), '') is distinct from 'service_role' then
    raise exception 'app: You cannot read reminder candidates.';
  end if;
  select value into v_settings
  from core.settings
  where key = 'installs.access_reminder_days'
  order by version desc
  limit 1;
  return jsonb_build_object(
    'settings', coalesce(v_settings, '{"weekly": true, "finalDaysBeforeStart": 7}'::jsonb),
    'installs', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id,
        'email', i.contact_email,
        'bookedOn', i.created_at::date,
        'startOn', i.start_on,
        'endOn', i.end_on,
        'submitted', i.access_submitted_at is not null,
        'mediaCount', i.access_media_count,
        'lastReminderOn', i.last_access_reminder_on
      ))
      from ops.installs i
      where i.status not in ('cancelled', 'completed')
        and i.contact_email is not null
        and i.start_on >= current_date
        and i.access_submitted_at is null
        and exists (
          select 1 from core.token_links t
          where t.purpose = 'access_form'
            and t.entity_schema = 'ops'
            and t.entity_table = 'installs'
            and t.entity_id = i.id
            and t.revoked_at is null
            and (t.expires_at is null or t.expires_at > now())
        )
    ), '[]'::jsonb)
  );
end;
$$;
