-- DESTRUCTIVE
-- Rolls back 20261128900000_order_tracker.sql.
-- Backup first. QC storage objects are left in place.
-- New file only. Do not apply to production.

do $$
begin
  if to_regclass('ops.order_tracker_photos') is not null then
    create table if not exists ops.order_tracker_photos_bak_20261128900000 (like ops.order_tracker_photos including all);
    insert into ops.order_tracker_photos_bak_20261128900000
    select * from ops.order_tracker_photos
    on conflict (id) do nothing;
    revoke all on ops.order_tracker_photos_bak_20261128900000 from public, anon, authenticated;
    alter table ops.order_tracker_photos_bak_20261128900000 enable row level security;
    alter table ops.order_tracker_photos_bak_20261128900000 force row level security;
  end if;

  if to_regclass('ops.order_trackers') is not null then
    create table if not exists ops.order_trackers_bak_20261128900000 (like ops.order_trackers including all);
    insert into ops.order_trackers_bak_20261128900000
    select * from ops.order_trackers
    on conflict (id) do nothing;
    revoke all on ops.order_trackers_bak_20261128900000 from public, anon, authenticated;
    alter table ops.order_trackers_bak_20261128900000 enable row level security;
    alter table ops.order_trackers_bak_20261128900000 force row level security;
  end if;
end
$$;

drop function if exists public.order_tracker_media(text, uuid);
drop function if exists public.order_tracker_save_snapshot(text, jsonb);
drop function if exists public.order_tracker_open(text);
drop function if exists public.order_tracker_photo_visible(uuid, boolean);
drop function if exists public.order_tracker_add_photo(uuid, uuid, text);
drop function if exists public.order_tracker_regenerate(uuid, text);
drop function if exists public.order_tracker_revoke(uuid);
drop function if exists public.order_tracker_create(text, text, text);
drop function if exists public.order_tracker_list(text);

drop table if exists ops.order_tracker_photos;
drop table if exists ops.order_trackers;

drop function if exists ops.tracker_public_snapshot(jsonb);
drop function if exists ops.tracker_require_staff();
drop function if exists ops.tracker_snapshot_ok(jsonb);
drop function if exists ops.tracker_photo_file();
