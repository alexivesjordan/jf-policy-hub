-- Install effort: rule-based SKU classification for the install pricer.
-- Port of scripts/install-effort/classify.py + families.py (same rules, same order) so no SKU list is needed.
-- Alex's decisions (24/11/2026): freight off install quotes; loose kit and Step & Decks delivery-only;
-- 2-tier horizontal dumbbell rack, vertical dumbbell rack, Olympic bar holder and standing mat hanger 1 x 10;
-- wall-fixed mat hangers delivery-only (0). Bolt-on shelves and uprights (J75 / HELIX / FSUK) are racks with no time. Other racks and unsure rows get needs_assembly NULL (the engine's
-- "Needs review" signal, see note below). needs_build rows keep their current crew/minutes.
-- Only rows with status 'suggested' are changed; confirmed rows are never touched.
-- Previous values: ops.sku_effort_backup_20261124 and ops.cin7_category_defaults_backup_20261124.
-- Rollback: 20261124160000_install_effort_classification.rollback.sql
-- Later per-family times, e.g.:
--   update ops.sku_effort set needs_assembly = true, crew = 1, build_minutes = 15, updated_at = now()
--   where rack_family = 'Kettlebell rack (2-tier / 3-tier / S-Series)' and status = 'suggested';
-- NOTE: engine.ts matchLine sends a SKU row with needs_assembly NULL to unknownAssembly(), which flags
-- "Needs review" but still prices it 2 x 120. Stopping that 2 x 120 needs a code change (effort_class below
-- tells the engine which rows are racks/unsure awaiting a time).

alter table ops.sku_effort
  add column if not exists effort_class text
    check (effort_class is null or effort_class in ('delivery_only', 'rack', 'needs_build', 'unsure')),
  add column if not exists effort_rule text,
  add column if not exists rack_family text;

comment on column ops.sku_effort.effort_class is
  'Install effort class from the 20261124 classification. delivery_only/rack/unsure rows are not reset by apply_suggested_profiles.';
comment on column ops.sku_effort.rack_family is
  'Rack product family: one build time per family, applied with one update.';

create table ops.sku_effort_backup_20261124 as
select sku, needs_assembly, crew, build_minutes, build_location, hq_build_minutes, hq_build_crew,
       site_position_minutes, suggestion_rule, effort_unit, updated_by, updated_at
from ops.sku_effort
where status = 'suggested';
alter table ops.sku_effort_backup_20261124 add primary key (sku);

create table ops.cin7_category_defaults_backup_20261124 as
select * from ops.cin7_category_defaults;
alter table ops.cin7_category_defaults_backup_20261124 add primary key (category);

alter table ops.sku_effort_backup_20261124 enable row level security;
alter table ops.cin7_category_defaults_backup_20261124 enable row level security;
revoke all on ops.sku_effort_backup_20261124, ops.cin7_category_defaults_backup_20261124 from public, anon, authenticated;

create temp table _ie as
-- classify:begin
with p as (
  select
    'hoodie|t-shirt|pick & pack|gift card|website|mould cost|powder ?coat|^stock code$|^message line$|balance brought forward|type description here|workshop|courses?\y|nutrition & programming|brochure|design costs|\ydvd\y|customi[sz]ation charge|\ycharge\y|membership|\ycourse\y|leaflet|catalogue|instructions|product-discounts|discount|\yservice\y|warranty|label application|\ydelivery\y|installation|\yinstall\y|\ypens\y|bottles of water|cardboard .*pallet|\ypallet\y|^marketing|carriage|postage|\yvinyl wrap\y|\ywrap(ping)? charge|labour|consultation|design fee|\yfee\y'::text non_physical,
    'bolt pack|\ybolts\y|roller bolts|anchor bolts|\ynuts\y|washers|end caps?|top cap|cap covers|\yfeet\y|foot plates|weight labels?|\ysaddles?\y|\ytrays?\y(?! -)|- cover\y|\ycover$|rack cover|(rack|spare|set of \d) wheels?|wheels \(set|\yprongs?\y|\ycradles?\y|stoppers?\y|\ybush(es)?\y|bush inserts?|\yinserts?\y|pull pins?|pop pin|adjuster pin|bench pin|assembly pins|\ypins?\y(?= -|$)|\yrubbers\y|rubber (ring|stopper|cushion|band)s?|replacement|\yspares?\y|\ybearings?\y|upholstery|\yknobs?\y|\yshroud\y|\ycable for\y|pulley wheels?|\ylid\y|eye ?bolt|eye nuts|shackle|plate holder rubber|weight tree arm|side rails|end bar|back bar|fixings|\yplug\y|adapter plug|\ydecals?\y|stickers?|\yleg\s*-\s*each|uprights? - (pair|\d+mm)|conversion bracket|filling nozzle|\yshelf\y.*- each|storage shelf|squat stand plates|\yspring - |fuzzy straps|non-slip handles|plank handles|platform pad|strap attachment|v-strap|pulldown (bar|handle)|ball holder for|rack plate holders|cage wheels|wooden base|rack holder for|cap washers|rack arm|rack (dumbbell|kettlebell|plate|wall ball) shelf|weight stack pin|lanyard'::text part,
    '\ybox \d\y|\(set of 2 boxes\)'::text box_component,
    '\yshelf\y|\yuprights?\y'::text bolt_on,
    '(&|\+|\yand\y|\ywith\y)\s*(\d+\s*x\s*)?(\w+\s+){0,3}racks?\y|set\s*\+\s*rack|&\s*\d+ pair rack'::text bundle,
    'power rack|half rack|squat rack|squat stands?\y|power stand|\yrig\y|\yrigs\y|cable rack|\yt rack\y|monkey bar|multi ?rack|wall mounted chin bar|pull ?up (station|rig)|cross ?fit rig|functional rig|\yj75 .*(rack|rig)\y|helix .*(rack|stand)\y|storage cage|lifting club squat stands'::text training_rack,
    '\yracks?\y|weight tree|bar holder|ball holder|band hanger|mats? (wall )?hanger|mat hanger|rower hanger|\yhanger\y|storage (system|rack|pod|hub|point|box)|\yshelving\y|\ythe hub\y|bar storage|ball storage|plate storage|ball rail|flat shelf|toaster rack|bosu rack|bag arms|storage point|mat frame|floor stand|\ystand\y(?! (wall|bolts))|wall mount\y|wall bracket|punch bag bracket|folding wall bracket|retractable punch bag bracket|height measure'::text storage_rack,
    'non-rack|rack attachment set|attachment rack - replacement|rack cover|for (\d+ pair )?racks|from fibo stand|fibo stand|t3 stand|grid stand|lat pulldown bar|for horizontal racks|rack weight label|dumbbell rack foot plates|breaker stand - spare'::text not_a_rack,
    '\ypumps?\y|pull ?pin|magnetic pin|round pin|power supply|gas struts|v handle|exchange handle|carabiner|weight numbers|rebounder spring|wrist guard|^sand$|tufnut|mega log|technique box|body fat monitor|seca \d+|sync box|comfort covers|modern box|dumn?bbell set|power wheel|hardwood ply|\ytape\y|adhesive|\yglue\y|cables - set|set of \d cables|\yhandles\y|pulldown bar|weight storage horn|\yballs?\y|\ybands?\y|\ymat\y|\ymats\y|\yropes?\y|\ybags?\y|cones?|hurdles?|ladders?|straps?|belts?|gloves?|rollers?|blocks?|\yrings?\y|\ysticks?\y|conditioner|cleaner|wipes|chalk|collars?|grips?|slings?|disc\y|discs\y|plates?\y|dumbbells?|kettlebells?|barbells?|\ybars?\y|hammer|sledge|bin\y|timer|clock|whistle|stopwatch|blazepod|pods?\y|bundle|kit\y|vest|weight vest|sandbag|bulgarian|parachute|sled harness|harness|tyre|tire|towel|bottle|rubber roll|\yroll\y|jump|skipping|foam|wedge|bolster|pad\y|pads\y|cushion|wobble|bosu|core plate|upholstery|ab wheel|push up|parallette|chains?\y|d shackle|insert - (un)?filled|spinning|swivel|hook'::text loose_names,
    'preacher curl|reformer|cadillac|wunda|chair|barrel|tower|\ybench(es)?\y|machine|station|trainer\y(?!.*(suspension|balance))|pulldown|leg press|hyper ?extension|back extension|glute (ham|drive|bridge machine)|hip thrust|\yglute\y.*(machine|bench)|dual adjustable pulley(?! (wheel|shroud|-))|functional trainer|lifting platform|platform\y|deadlift platform|\ypin loaded\y|plate loaded|selectori[sz]ed|lat pull|chest press|smith|cable crossover|treadmill|bike|rower|elliptical|stepper|climber|sled\y(?! track)|prowler|trampoline|wall mounted|wall-mounted|freestanding punch bag|speedball platform|target board|grid wall|studio\y.*(set|system)|frame\y'::text build_names,
    'attachment|crossbeam|pull ?up bar|j-?hooks?|safety (straps|bars?|arms|spot arms|squat arms)|spot arms|uprights|wall plates|storage board|\yhooks?\y|\ypole\y|brackets|loop assembly|band (frame )?holders|band pegs|weight horns?'::text attach,
    array['Balance Training', 'Barbells', 'Bars', 'Boxing Accessories', 'Boxing Gloves & Pads', 'Bumper Plates', 'Cable Attachments', 'Cleaning', 'Core & Mobility', 'Dumbbells', 'Fixed Barbells', 'Functional Training Balls', 'Gym Balls', 'Kettlebells', 'Mats', 'Plyo Boxes', 'Reaction Training', 'Recovery', 'Resistance', 'Resistance Bands', 'Rope Trainers', 'Sandbags', 'Speed & Agility', 'Step & Decks', 'Strongman Training', 'Studio Barbells', 'Studio Dumbbells', 'Suspension Training', 'Tires', 'Training Bags', 'Training Balls', 'Unstable Load Training', 'Weight Plates', 'Weightlifting Accessories']::text[] loose_cats,
    array['Bikes', 'Elliptical Trainers', 'Glute Training', 'Gym Flooring', 'Rowers', 'Ski Machines', 'Stair Climbers', 'Strength Machines', 'Treadmills', 'Weight Benches']::text[] build_cats
),
b as (
  select e.sku, e.needs_assembly na, e.crew, e.build_minutes bm,
         t.n, lower(t.n) nl, coalesce(e.cin7_category, '') c,
         regexp_replace(regexp_replace(t.n, '\y(with|including|inc\.?|incl\.?)\y.*$', '', 'i'), '\([^)]*\)', '', 'g') core,
         regexp_replace(lower(t.n), '\y(including|with|excluding)\y.*$', '') core_l
  from ops.sku_effort e
  cross join lateral (select btrim(coalesce(e.product_name, ''), E' \t\r\n') n) t
  where e.status = 'suggested'
),
r as (
  select b.*, split_part(x.cr, ':', 1) cls0, split_part(x.cr, ':', 2) rule0
  from b cross join p
  cross join lateral (select case
    when b.n ~* p.non_physical or b.c in ('Service', 'Powder Coating') or upper(b.sku) like 'MARKETING%' then 'delivery_only:non_physical'
    when b.n ~* p.box_component and b.nl !~ 'set of 2 boxes' then 'delivery_only:box_component'
    when b.core ~* p.bolt_on and b.nl !~ 'end cap|replacement|spare|\ycap\y|power sled'
         and b.c in ('Rigs & Racks', 'Rig & Rack Attachments', 'Gym Storage', 'Functional Fitness', 'Other') then 'rack:bolt_on_component'
    when b.core ~* p.part and b.n !~* p.bundle and b.c <> 'Gym Flooring' then 'delivery_only:part'
    when b.c = any(p.build_cats) and not (b.c = 'Strength Machines' and b.nl ~ 'stand|rack') then 'needs_build:build_category'
    when b.nl ~ 'freestanding punch bag' then 'unsure:punchbag_free'
    when b.nl ~ 'mat (adjustable )?wall hanger|side mat hanger|mat wall bracket' then 'delivery_only:alex_wall_mat_hanger'
    when (b.core_l ~ p.attach or b.core_l ~ 'plate holder - each|safety bars')
         and b.nl !~ 'bay rig|rack only|rig only|package \d|rack attachment set|attachment rack'
         and b.c in ('Rigs & Racks', 'Rig & Rack Attachments', 'Functional Fitness', 'Gym Storage', 'Other', 'Strength Machines')
      then case when b.nl ~ 'j-?hooks?|\yhooks?\y|band pegs|safety straps|horns?|band holders'
                then 'delivery_only:rig_attachment_dropIn' else 'needs_build:rig_attachment_boltOn' end
    when b.n !~* p.not_a_rack and b.n ~* p.bundle then 'rack:bundle_with_rack'
    when b.n !~* p.not_a_rack and b.n ~* p.storage_rack
         and b.nl !~ '(power|half|squat|cable|t-)\s*rack|\yrig\y|squat stand|power stand' then 'rack:storage_rack'
    when b.n !~* p.not_a_rack and (b.n ~* p.training_rack or (b.c = 'Rigs & Racks' and b.nl ~ 'rack|rig|stand')) then 'rack:training_rack'
    when b.c = any(p.build_cats) then 'needs_build:build_category'
    when b.c = 'Rig & Rack Attachments' then case
      when b.nl ~ 'crossbeam|cross ?member|pull ?up bar|wall plate|weight storage|monolift|safety (arm|bar|spot)|spotter|dip (station|attachment|bar)|landmine|lever arm|jammer|plate storage|storage attachment|ball target|sling trainer|beam|extension|upright|frame'
        then 'needs_build:rig_attachment_boltOn'
      when b.nl ~ 'j-?hooks?|band pegs?|peg|horn|hook|strap|pin|carabiner|clip' then 'delivery_only:rig_attachment_dropIn'
      else 'unsure:rig_attachment_unclear' end
    when b.c = any(p.loose_cats) and b.nl ~ 'suspension training station|lifting platform' then 'needs_build:name_build'
    when b.c = any(p.loose_cats) then 'delivery_only:loose_category'
    when b.c = 'Punch Bags' then case when b.nl ~ 'freestanding|free standing' then 'delivery_only:punchbag_free' else 'delivery_only:punchbag' end
    when b.c = 'Sleds' then case when b.nl ~ 'track' then 'needs_build:sled_track'
                                 when b.nl ~ 'harness|strap|rope|belt' then 'delivery_only:sled_acc' else 'unsure:sled' end
    when b.c = 'Trampolines' then 'needs_build:name_build'
    when b.n ~* p.build_names then 'needs_build:name_build'
    when b.n ~* p.loose_names then 'delivery_only:name_loose'
    else 'unsure:no_rule' end cr) x
),
o as (
  select r.*, coalesce(v.cls, r.cls0) cls, coalesce(v.rule, r.rule0) rule
  from r left join (values
    ('JLSHM-213-PG', 'unsure', 'override'),
    ('JTMR-15A', 'rack', 'override_alex'),
    ('JF-BWM-D', 'delivery_only', 'override'),
    ('JL-TSW-4', 'needs_build', 'override'),
    ('JL-RUBRIGMISC', 'unsure', 'override'),
    ('JLPWTGT-E', 'unsure', 'override'),
    ('JLPWTGT-P', 'unsure', 'override')
  ) v(sku, cls, rule) on v.sku = r.sku
),
f as (
  select o.*,
         case when o.rule = 'bolt_on_component' then 'Bolt-on shelves & uprights (J75 / HELIX / Freestanding Gym Storage)' else fm.family end rack_family,
         case when o.rule = 'bolt_on_component' then 'storage' else fm.grp end rack_group
  from o left join lateral (
    select coalesce(min(family) filter (where rk = 1), '(unmatched)') family, coalesce(min(grp) filter (where rk = 1), '?') grp
    from (select ff.family, ff.grp, row_number() over (order by ff.ord) rk
          from (values
            (1, 'Dumbbell + rack bundles (rack must be built)', 'storage', '(dumbbells?|dumbbell set).*(&|\+|and|with).*rack'),
            (2, 'Studio barbell set + rack bundles', 'storage', 'barbell sets?.*(&|with).*rack|barbell set\+rack'),
            (3, 'Studio dumbbells + rack bundles', 'storage', 'studio dumbbells and .*rack'),
            (4, 'Elite / Performance / Core Strength Storage dumbbell racks', 'storage', '(elite|performance|core) strength storage.*dumbbell rack'),
            (5, 'Elite / Performance Strength Storage barbell racks', 'storage', '(elite|performance|core) strength storage.*barbell rack'),
            (6, 'Elite / Performance / Core Strength Storage Olympic weight trees', 'storage', '(elite|performance|core) strength storage.*weight tree'),
            (7, 'Dumbbell rack, 3-tier (oval / hex / custom)', 'storage', '3 tier.*dumbbell rack|dumbbell rack.*3 tier|3 tier hex'),
            (8, 'Dumbbell rack, 2-tier horizontal (oval / S-Series / hex / custom)', 'storage', '(2 tier|horizontal).*dumbbell rack|dumbbell rack.*2 tier|2 tier hex'),
            (9, 'Vertical dumbbell rack (incl. 4-sided)', 'storage', 'vertical (dumbbell )?rack|vertical rack'),
            (10, 'Studio dumbbell rack (with wheels)', 'storage', 'studio dumbbell rack'),
            (11, 'Vertical dumbbell rack (incl. 4-sided)', 'storage', '^jordan dumbbell rack$'),
            (12, 'Fixed barbell rack JF-BBR (5 / 10 bar)', 'storage', 'fixed barbell rack'),
            (13, 'Studio barbell rack (12 / 30 sets)', 'storage', 'studio barbell rack'),
            (14, 'Olympic bar holder (holds 8 / 9, holder-only, plate)', 'storage', 'olympic bar holder'),
            (15, 'Barbell rack, oval / 5-bar / 10-bar (JTBR) + wall-mounted bar rack', 'storage', 'wall mounted bar rack'),
            (16, 'Barbell rack, oval / 5-bar / 10-bar (JTBR) + wall-mounted bar rack', 'storage', 'barbell rack|barbell rack holders'),
            (17, 'Olympic weight tree (JF-OWT / JTOWT)', 'storage', 'weight tree'),
            (18, 'Plate racks (toaster / training plate / vertical portable)', 'storage', 'plate (toaster )?rack|training plate rack|plate storage rack'),
            (19, 'Kettlebell rack (2-tier / 3-tier / S-Series)', 'storage', 'kettlebell rack'),
            (20, 'Medicine / slam ball rack (incl. oversized)', 'storage', 'medicine|med ball|slam ball rack|oversized'),
            (21, 'Gym / fit ball rack (3 / 6 ball)', 'storage', '(gym|fit) ball rack'),
            (22, 'Wall ball rack / wall ball & gym ball holders', 'storage', 'wall ball (rack|holder)|gym ball holder'),
            (23, 'Sandbag rack (4 / 5 / 8 bags)', 'storage', 'sandbag rack'),
            (24, 'BOSU rack', 'storage', 'bosu rack'),
            (25, 'Sports mat storage rack (single / double sided, bolt-down)', 'storage', 'mat (storage )?rack|sport mat storage|mat frame'),
            (26, 'Mat hanger (standing or sports-mat hanger: confirm type)', 'storage', 'mat(s)? hanger'),
            (27, 'Freestanding Gym Storage System (JF-FSUK full units + add-ons)', 'storage', 'free ?standing gym storage system'),
            (28, 'Cable attachment rack (incl. JTMR-15A set)', 'storage', 'attachment rack|machine rack attachment set'),
            (29, 'Wall hangers: power band / rower / battle-rope storage point', 'storage', 'band hanger|rower hanger|rope storage point|storage point'),
            (30, 'Punch bag brackets & bag arms (wall/ceiling fixed)', 'storage', 'punch bag bracket|wall bracket|bag arms|punch bag.*bracket'),
            (31, 'Storage units: pod / hub / box / multipurpose rack / HELIX multi storage / studio bar & ball storage', 'storage', 'storage pod|storage hub|the hub|multipurpose gym storage|multi storage rack|storage box|bar storage|ball storage'),
            (32, 'Storage cage', 'storage', 'storage cage'),
            (33, 'HELIX power / half racks & power stand', 'training', 'helix.*(power rack|half rack|power stand)'),
            (34, 'Squat stands & squat racks (HELIX adjustable, heavy duty, Lifting Club, Olympic, JF-SRUK)', 'training', 'squat (stand|rack)'),
            (35, 'J75 rigs (2-10 bay)', 'training', 'j75.*\yrig\y'),
            (36, 'J75 compact power rack / cable rack / T-rack', 'training', 'j75.*(power rack|cable rack|t-?rack)'),
            (37, 'Power rack JTPR / other power racks', 'training', 'power rack'),
            (38, 'Wall-mounted chin bar', 'training', 'chin bar'),
            (39, 'Half racks (Lifting Club / Performance Range) & folding multi-use rack', 'training', 'half rack|folding multi-use gym rack'),
            (40, 'HEGREN Pilates accessory / stick / stability-bar wall racks', 'storage', 'hegren.*rack'),
            (41, 'Dumbbell breaker stand', 'storage', 'dumbbell breaker stand')
          ) ff(ord, family, grp, pat) where o.nl ~ ff.pat) m
  ) fm on o.cls = 'rack'
)
select f.sku, f.cls, f.rule,
       case when f.cls = 'rack' then f.rack_family end rack_family,
       case when f.cls = 'rack' then f.rack_group end rack_group,
       q.people, q.minutes
from f
cross join lateral (select case
    when f.cls = 'delivery_only' then 1
    when f.cls = 'needs_build' then case when f.na is null or f.bm is null then null else f.crew end
    when f.cls = 'rack' and f.sku = 'JL-VDR' then null
    when f.cls = 'rack' and (f.rack_family in ('Dumbbell rack, 2-tier horizontal (oval / S-Series / hex / custom)', 'Vertical dumbbell rack (incl. 4-sided)', 'Olympic bar holder (holds 8 / 9, holder-only, plate)') or f.n ~* 'free ?standing gym storage system - mat hanger') then 1
  end people,
  case
    when f.cls = 'delivery_only' then 0
    when f.cls = 'needs_build' then case when f.na is null then null else f.bm end
    when f.cls = 'rack' and f.sku = 'JL-VDR' then null
    when f.cls = 'rack' and (f.rack_family in ('Dumbbell rack, 2-tier horizontal (oval / S-Series / hex / custom)', 'Vertical dumbbell rack (incl. 4-sided)', 'Olympic bar holder (holds 8 / 9, holder-only, plate)') or f.n ~* 'free ?standing gym storage system - mat hanger') then 10
  end::numeric minutes) q
-- classify:end
;

update ops.sku_effort e
set effort_class = c.cls,
    effort_rule = c.rule,
    rack_family = c.rack_family,
    needs_assembly = case c.cls when 'needs_build' then e.needs_assembly when 'delivery_only' then false
                     else case when c.minutes is null then null else true end end,
    crew = case when c.cls = 'needs_build' then e.crew else c.people end,
    build_minutes = case when c.cls = 'needs_build' then e.build_minutes else c.minutes end,
    build_location = case when c.cls = 'delivery_only' then 'site' else e.build_location end,
    hq_build_minutes = case when c.cls = 'delivery_only' then null else e.hq_build_minutes end,
    hq_build_crew = case when c.cls = 'delivery_only' then null else e.hq_build_crew end,
    site_position_minutes = case when c.cls = 'delivery_only' then null else e.site_position_minutes end,
    updated_at = now()
from _ie c
where e.sku = c.sku and e.status = 'suggested';

drop table _ie;

-- Loose-kit categories: handling only for SKUs that sync in later.
insert into ops.cin7_category_defaults (category, needs_assembly, crew, build_minutes, status, notes, build_location, effort_unit)
select v, false, 1, 0, 'suggested', 'Loose kit: delivery and handling only (Alex, 24/11/2026).', 'site', 'each'
from unnest(array['Balance Training', 'Barbells', 'Bars', 'Boxing Accessories', 'Boxing Gloves & Pads', 'Bumper Plates', 'Cable Attachments', 'Cleaning', 'Core & Mobility', 'Dumbbells', 'Fixed Barbells', 'Functional Training Balls', 'Gym Balls', 'Kettlebells', 'Mats', 'Plyo Boxes', 'Reaction Training', 'Recovery', 'Resistance', 'Resistance Bands', 'Rope Trainers', 'Sandbags', 'Speed & Agility', 'Step & Decks', 'Strongman Training', 'Studio Barbells', 'Studio Dumbbells', 'Suspension Training', 'Tires', 'Training Bags', 'Training Balls', 'Unstable Load Training', 'Weight Plates', 'Weightlifting Accessories']::text[]) v
on conflict (category) do update
set needs_assembly = false, crew = 1, build_minutes = 0, build_location = 'site',
    hq_build_minutes = null, hq_build_crew = null, site_position_minutes = null,
    notes = excluded.notes, updated_at = now()
where ops.cin7_category_defaults.status = 'suggested'
  and (ops.cin7_category_defaults.needs_assembly is distinct from false
       or ops.cin7_category_defaults.crew is distinct from 1
       or ops.cin7_category_defaults.build_minutes is distinct from 0
       or ops.cin7_category_defaults.build_location <> 'site');

-- Product sync calls this after every run. Keep per-SKU classified rows instead of resetting them to the category default.
create or replace function ops.apply_suggested_profiles()
returns void
language plpgsql
as $$
begin
  update ops.sku_effort e
  set needs_assembly = d.needs_assembly,
      crew = d.crew,
      build_minutes = d.build_minutes,
      effort_unit = d.effort_unit,
      build_location = d.build_location,
      hq_build_minutes = d.hq_build_minutes,
      hq_build_crew = d.hq_build_crew,
      site_position_minutes = d.site_position_minutes,
      suggestion_rule = null,
      updated_at = now()
  from ops.cin7_category_defaults d
  where e.status = 'suggested'
    and coalesce(e.effort_class, 'needs_build') = 'needs_build'
    and e.cin7_category = d.category
    and not ops.pin_loaded_suggestion(e.sku, e.product_name)
    and not ops.sled_track_suggestion(e.product_name, e.sku);

  update ops.sku_effort e
  set needs_assembly = s.needs_assembly,
      crew = s.crew,
      build_minutes = s.build_minutes,
      effort_unit = s.effort_unit,
      build_location = s.build_location,
      hq_build_minutes = s.hq_build_minutes,
      hq_build_crew = s.hq_build_crew,
      site_position_minutes = s.site_position_minutes,
      suggestion_rule = 'pin-loaded',
      updated_at = now()
  from ops.cin7_category_defaults s
  where s.category = 'Strength Machines'
    and e.status = 'suggested'
    and coalesce(e.effort_class, 'needs_build') = 'needs_build'
    and ops.pin_loaded_suggestion(e.sku, e.product_name)
    and not ops.sled_track_suggestion(e.product_name, e.sku);

  update ops.sku_effort e
  set needs_assembly = true,
      crew = 2,
      build_minutes = 180,
      effort_unit = 'm2',
      build_location = 'site',
      hq_build_minutes = null,
      hq_build_crew = null,
      site_position_minutes = null,
      suggestion_rule = 'sled-track',
      updated_at = now()
  where e.status = 'suggested'
    and coalesce(e.effort_class, 'needs_build') = 'needs_build'
    and ops.sled_track_suggestion(e.product_name, e.sku);
end;
$$;

revoke all on function ops.apply_suggested_profiles() from public, anon, authenticated;
