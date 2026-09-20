-- Adds the four WAEC science subjects Sdash serves to the WAEC catalogue.
--
-- Forward-only: no earlier migration is edited. The four subject rows already
-- exist in public.subjects from the M1 catalogue seed (202609060002), so this
-- migration creates exam_subjects relationships only — it never re-seeds a
-- subject and never changes a subject's name.
--
-- Provider coverage behind these four (verified live against type=wassce):
--   biology              -> Sdash "biology"      (2018)
--   chemistry            -> Sdash "chemistry"    (2012)
--   physics              -> Sdash "physics"      (2025)
--   agricultural-science -> Sdash "agriculture"  (2025)
-- The existing eleven WAEC subjects continue to be served by ALOC Station.
-- See features/questions/routing.ts and SDASH-COVERAGE-NOTES.md.
--
-- English Language and Further Mathematics are deliberately NOT added:
-- Sdash returns HTTP 403 for English on the Sandbox tier, and Further
-- Mathematics is absent from its subject catalogue. Neither has a verified
-- source, so neither may be offered.
--
-- Idempotent: re-applying it changes nothing, and it never marks a subject
-- compulsory. WAEC's onboarding rule stays "between one and nine subjects",
-- so existing student selections remain valid and can be extended later.

-- The four subjects must already exist in the catalogue. Failing loudly here is
-- better than silently linking nothing and leaving the product short.
do $$
declare
  v_missing text;
begin
  select string_agg(slug, ', ')
  into v_missing
  from (values ('biology'), ('chemistry'), ('physics'), ('agricultural-science')) as required(slug)
  where not exists (select 1 from public.subjects where subjects.slug = required.slug);

  if v_missing is not null then
    raise exception 'Missing subject catalogue rows for: %. Apply the M1 catalogue seed first.', v_missing;
  end if;
end;
$$;

-- Science subjects sit immediately after Mathematics rather than at the end of
-- the list: a WAEC science candidate should not have to scroll past eleven
-- commercial and arts subjects to find Physics. Only display_order changes for
-- the existing eleven — every relationship, its subject and its
-- is_compulsory = false are left exactly as they were.
with waec as (
  select id from public.exam_bodies where code = 'waec'
), ordered_subjects(slug, display_order) as (
  values
    ('mathematics', 1),
    ('biology', 2),
    ('chemistry', 3),
    ('physics', 4),
    ('agricultural-science', 5),
    ('economics', 6),
    ('government', 7),
    ('commerce', 8),
    ('literature-in-english', 9),
    ('principles-of-accounts', 10),
    ('geography', 11),
    ('christian-religious-studies', 12),
    ('civic-education', 13),
    ('history', 14),
    ('insurance', 15)
)
insert into public.exam_subjects (exam_body_id, subject_id, is_compulsory, display_order)
select waec.id, subjects.id, false, ordered_subjects.display_order
from waec
join ordered_subjects on true
join public.subjects on subjects.slug = ordered_subjects.slug
on conflict (exam_body_id, subject_id) do update set
  display_order = excluded.display_order;
