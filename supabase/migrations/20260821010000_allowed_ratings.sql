-- Per-profile allowed ratings, replacing the single max_rating ceiling.
--
-- A ceiling assumes the rating systems are one ordered ladder. They are not.
-- The TV Parental Guidelines (1997) and the MPAA letters are different systems
-- from different eras, and MPAA meanings moved: PG-13 did not exist until 1984,
-- so pre-1984 PG absorbed what would now be PG-13. Airplane! (1980) is rated PG
-- and contains nudity. A ceiling of "PG" therefore cannot express "modern
-- children's programming" -- but an explicit set can.
--
-- Safe to re-run.

alter table public.household_profiles
  add column if not exists allowed_ratings text[];

-- Backfill existing profiles from their ceiling so nothing changes for them
-- until a parent edits the profile.
update public.household_profiles
set allowed_ratings = case max_rating
    when 'TV-Y'  then array['TV-Y']
    when 'TV-G'  then array['TV-Y','TV-Y7','TV-Y7-FV','TV-G']
    when 'PG'    then array['TV-Y','TV-Y7','TV-Y7-FV','TV-G','TV-PG']
    when 'TV-14' then array['TV-Y','TV-Y7','TV-Y7-FV','TV-G','TV-PG','TV-14']
    else null
  end
where allowed_ratings is null
  and max_rating is not null
  and max_rating <> '';

comment on column public.household_profiles.allowed_ratings is
  'Explicit set of permitted rating strings. NULL means unrestricted (adult). '
  'Replaces max_rating, which assumed a single ordered ladder across two '
  'incompatible rating systems.';
