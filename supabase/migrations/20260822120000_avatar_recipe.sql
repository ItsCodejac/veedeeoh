-- Remember how an avatar was made, not just what it looks like.
--
-- avatar_url holds the finished image, which is the right thing to store for
-- DISPLAY: it renders anywhere without loading a 678 KB generator, and it
-- cannot change under someone when the library updates its artwork.
--
-- What it cannot do is be edited. Reopening the profile editor showed the
-- current avatar selected and every customisation control back at Random,
-- because a PNG-shaped thing does not remember that its eyes were set to
-- hearts. Changing one feature meant rebuilding the whole choice from memory.
--
-- So the recipe travels alongside the picture. Small -- a style name, a seed
-- and a handful of feature choices -- and used only by the editor. Nothing
-- reads it to render, so an unknown or removed style degrades to "the stored
-- image still displays, the controls start fresh", which is exactly today's
-- behaviour rather than a broken profile.
--
-- Safe to re-run.

alter table public.household_profiles
  add column if not exists avatar_recipe jsonb;

comment on column public.household_profiles.avatar_recipe is
  'How avatar_url was generated: { style, seed, choices }. Editor-only. The '
  'image in avatar_url stays authoritative for display, so a recipe that no '
  'longer resolves costs nothing.';
