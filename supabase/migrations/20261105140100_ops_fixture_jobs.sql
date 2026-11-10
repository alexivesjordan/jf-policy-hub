-- FIXTURE / not production data.
-- Demo install jobs so the office shell can be opened before Cin7 exists.
-- Numbers prefixed FIXTURE- are not Cin7 ids. Segment and customer type on
-- these rows are labels for the screen, not a Cin7 field mapping.
-- Safe to delete later: customers whose cin7_id starts with FIXTURE-.

insert into ops.customers (id, cin7_id, name, customer_type, segment)
values
  (
    'f1000000-0000-4000-8000-000000000001',
    'FIXTURE-CUST-1',
    'FIXTURE — Riverside Gym',
    'proforma',
    'independent'
  ),
  (
    'f1000000-0000-4000-8000-000000000002',
    'FIXTURE-CUST-2',
    'FIXTURE — Northside Fitness',
    null,
    'trade'
  ),
  (
    'f1000000-0000-4000-8000-000000000003',
    'FIXTURE-CUST-3',
    'FIXTURE — City Athletic',
    'leasing',
    'big_corporate'
  );

insert into ops.sites (id, customer_id, name, address_line1, city, postcode)
values
  (
    'f1100000-0000-4000-8000-000000000001',
    'f1000000-0000-4000-8000-000000000001',
    'FIXTURE riverside',
    '1 Fixture Wharf',
    'Bristol',
    'BS1 4ST'
  ),
  (
    'f1100000-0000-4000-8000-000000000002',
    'f1000000-0000-4000-8000-000000000002',
    'FIXTURE northside',
    '2 Fixture Yard',
    'Leeds',
    'LS1 4DY'
  ),
  (
    'f1100000-0000-4000-8000-000000000003',
    'f1000000-0000-4000-8000-000000000003',
    'FIXTURE city',
    '3 Fixture Lane',
    'London',
    'EC1A 1BB'
  );

insert into ops.install_jobs (
  id,
  cin7_number,
  cin7_quote_number,
  job_type,
  customer_id,
  site_id,
  status,
  big_install,
  big_install_triggers,
  booked_date,
  arrival_window,
  hold_reason,
  hold_review_date
) values
  (
    'f2000000-0000-4000-8000-000000000001',
    'FIXTURE-1001',
    'FIXTURE-1001',
    'install',
    'f1000000-0000-4000-8000-000000000001',
    'f1100000-0000-4000-8000-000000000001',
    'priced',
    false,
    '{}',
    null,
    null,
    null,
    null
  ),
  (
    'f2000000-0000-4000-8000-000000000002',
    'FIXTURE-1002',
    'FIXTURE-1002',
    'install',
    'f1000000-0000-4000-8000-000000000002',
    'f1100000-0000-4000-8000-000000000002',
    'awaiting_access',
    true,
    array['town_or_city_centre', 'non_ground_or_stairs'],
    null,
    null,
    null,
    null
  ),
  (
    'f2000000-0000-4000-8000-000000000003',
    'FIXTURE-1003',
    'FIXTURE-1003',
    'install',
    'f1000000-0000-4000-8000-000000000003',
    'f1100000-0000-4000-8000-000000000003',
    'booked',
    false,
    '{}',
    current_date + 21,
    '08:00–10:00',
    null,
    null
  ),
  (
    'f2000000-0000-4000-8000-000000000004',
    'FIXTURE-1004',
    'FIXTURE-1004',
    'install',
    'f1000000-0000-4000-8000-000000000001',
    'f1100000-0000-4000-8000-000000000001',
    'on_hold',
    false,
    '{}',
    null,
    null,
    'FIXTURE — waiting on a site date',
    current_date + 14
  );

-- One in-app note when Alex already has a profile. Fresh databases where
-- Alex signs up later start with an empty operations inbox.
insert into core.notifications (user_id, title, body, kind, channel, link)
select
  p.id,
  'FIXTURE — Install office',
  'This is demo data, not a live job alert. Open Jobs to see the fixture installs.',
  'fixture',
  'in_app',
  '/operations/jobs'
from public.profiles p
where lower(p.email) = 'alex.ives@jordanfitness.com'
  and not exists (
    select 1
    from core.notifications n
    where n.user_id = p.id
      and n.kind = 'fixture'
      and n.title = 'FIXTURE — Install office'
  );
