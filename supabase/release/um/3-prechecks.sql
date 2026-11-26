-- Read only. Run before the org chart migrations.
-- Expected: companies and positions are absent. Ids are not listed.
-- Do not apply to production.

select to_regclass('core.companies') as companies, to_regclass('hr.positions') as positions;
