-- TEST only. Fake addresses. Do not run on production.
-- 19 people, two companies, Sales Director left vacant.

do $$
declare
  v_jf uuid;
  v_jm uuid;
  v_dir uuid;
  v_ops uuid;
  v_sales uuid;
  v_finance uuid;
  v_trade uuid;
begin
  if exists (select 1 from hr.employees where work_email = 'neil.seed@example.test') then
    return;
  end if;
  select id into v_jf from core.companies where name = 'Jordan Fitness';
  select id into v_jm from core.companies where name = 'Jordan Metalwork';
  select id into v_dir from hr.positions where title = 'Directors' limit 1;

  insert into hr.positions (title, reports_to_position_id, company_id)
  values ('Operations Manager', v_dir, v_jf) returning id into v_ops;
  insert into hr.positions (title, reports_to_position_id, company_id)
  values ('Sales Director', v_dir, v_jf) returning id into v_sales;
  insert into hr.positions (title, reports_to_position_id, company_id)
  values ('Head of Finance', v_dir, v_jf) returning id into v_finance;
  insert into hr.positions (title, reports_to_position_id, company_id)
  values ('Internal Trade Sales', v_sales, v_jf) returning id into v_trade;

  insert into hr.positions (title, reports_to_position_id, company_id) values
    ('Aftersales', v_ops, v_jf),
    ('Warehouse Supervisor', v_ops, v_jf),
    ('Warehouse', v_ops, v_jf),
    ('Warehouse Assistant', v_ops, v_jf),
    ('Fabricator', v_ops, v_jm),
    ('Procurement', v_dir, v_jf),
    ('Finance Assistant', v_finance, v_jf),
    ('Trade Support', v_trade, v_jf),
    ('Head of Marketing', v_dir, v_jf),
    ('Sales Executive', v_sales, v_jf);

  insert into hr.employees (full_name, work_email, status, company_id) values
    ('Neil', 'neil.seed@example.test', 'active', v_jf),
    ('Deborah', 'deborah.seed@example.test', 'active', v_jf),
    ('Simon', 'simon.seed@example.test', 'active', v_jf),
    ('Alex', 'alex.seed@example.test', 'active', v_jf),
    ('Ben', 'ben.seed@example.test', 'active', v_jf),
    ('Peter', 'peter.seed@example.test', 'active', v_jf),
    ('Marius', 'marius.seed@example.test', 'active', v_jf),
    ('Lewis', 'lewis.seed@example.test', 'active', v_jf),
    ('Christian', 'christian.seed@example.test', 'active', v_jf),
    ('Adrian', 'adrian.seed@example.test', 'active', v_jm),
    ('Steve', 'steve.seed@example.test', 'active', v_jm),
    ('Kelly', 'kelly.seed@example.test', 'active', v_jf),
    ('Harriett', 'harriett.seed@example.test', 'active', v_jf),
    ('Trudy', 'trudy.seed@example.test', 'active', v_jf),
    ('Diana', 'diana.seed@example.test', 'active', v_jf),
    ('Aislin', 'aislin.seed@example.test', 'active', v_jf),
    ('Michelle', 'michelle.seed@example.test', 'active', v_jf),
    ('Liz', 'liz.seed@example.test', 'active', v_jf),
    ('Nik', 'nik.seed@example.test', 'active', v_jf);

  update hr.positions set allow_multiple = true where title in ('Directors', 'Warehouse', 'Warehouse Assistant', 'Fabricator', 'Trade Support');

  insert into hr.position_holders (position_id, employee_id)
  select p.id, e.id
  from (values
    ('Directors', 'neil.seed@example.test'),
    ('Directors', 'deborah.seed@example.test'),
    ('Operations Manager', 'simon.seed@example.test'),
    ('Aftersales', 'alex.seed@example.test'),
    ('Warehouse Supervisor', 'ben.seed@example.test'),
    ('Warehouse', 'peter.seed@example.test'),
    ('Warehouse Assistant', 'marius.seed@example.test'),
    ('Warehouse', 'lewis.seed@example.test'),
    ('Warehouse Assistant', 'christian.seed@example.test'),
    ('Fabricator', 'adrian.seed@example.test'),
    ('Fabricator', 'steve.seed@example.test'),
    ('Procurement', 'kelly.seed@example.test'),
    ('Head of Finance', 'harriett.seed@example.test'),
    ('Finance Assistant', 'trudy.seed@example.test'),
    ('Internal Trade Sales', 'diana.seed@example.test'),
    ('Trade Support', 'aislin.seed@example.test'),
    ('Trade Support', 'michelle.seed@example.test'),
    ('Head of Marketing', 'liz.seed@example.test'),
    ('Sales Executive', 'nik.seed@example.test')
  ) as seat(title, email)
  join hr.positions p on p.title = seat.title
  join hr.employees e on e.work_email = seat.email;

  update hr.employees e
  set position_id = h.position_id
  from hr.position_holders h
  where h.employee_id = e.id and h.to_date is null and e.work_email like '%@example.test';

  update hr.employees e
  set lead_id = lead.id
  from hr.employees lead
  where e.work_email in ('peter.seed@example.test', 'marius.seed@example.test')
    and lead.work_email = 'ben.seed@example.test';

  perform hr.sync_manager_ids();
end
$$;
