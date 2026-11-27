-- Drops public.supply_match_codes from 20261128700400_supply_match_codes.sql.
-- New file only. Do not apply to production.

drop function if exists public.supply_match_codes(text, jsonb);
