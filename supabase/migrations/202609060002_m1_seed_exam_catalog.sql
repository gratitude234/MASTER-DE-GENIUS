-- Initial exam/subject catalogue for onboarding.
-- The subject catalogue is configuration data, not a legal/official JAMB brochure.
-- Verify the active JAMB brochure before launch and adjust this seed if needed.

insert into public.exam_bodies (code, name, short_name, description)
values
  ('jamb', 'Joint Admissions and Matriculation Board', 'JAMB', 'UTME preparation and mock examinations'),
  ('waec', 'West African Examinations Council', 'WAEC', 'WASSCE preparation'),
  ('neco', 'National Examinations Council', 'NECO', 'SSCE preparation'),
  ('post_utme', 'Post-UTME', 'Post-UTME', 'Institution-specific post-UTME preparation'),
  ('school', 'School Examinations', 'School', 'School and internal assessment preparation')
on conflict (code) do update set
  name = excluded.name,
  short_name = excluded.short_name,
  description = excluded.description;

insert into public.subjects (slug, name)
values
  ('use-of-english', 'Use of English'),
  ('mathematics', 'Mathematics'),
  ('physics', 'Physics'),
  ('chemistry', 'Chemistry'),
  ('biology', 'Biology'),
  ('agricultural-science', 'Agricultural Science'),
  ('economics', 'Economics'),
  ('government', 'Government'),
  ('literature-in-english', 'Literature in English'),
  ('christian-religious-studies', 'Christian Religious Studies'),
  ('islamic-studies', 'Islamic Studies'),
  ('geography', 'Geography'),
  ('commerce', 'Commerce'),
  ('principles-of-accounts', 'Principles of Accounts'),
  ('history', 'History'),
  ('french', 'French'),
  ('hausa', 'Hausa'),
  ('igbo', 'Igbo'),
  ('yoruba', 'Yoruba'),
  ('arabic', 'Arabic'),
  ('music', 'Music'),
  ('fine-art', 'Fine Art'),
  ('home-economics', 'Home Economics')
on conflict (slug) do update set name = excluded.name;

with jamb as (
  select id from public.exam_bodies where code = 'jamb'
), ordered_subjects(slug, is_compulsory, display_order) as (
  values
    ('use-of-english', true, 1),
    ('mathematics', false, 2),
    ('physics', false, 3),
    ('chemistry', false, 4),
    ('biology', false, 5),
    ('agricultural-science', false, 6),
    ('economics', false, 7),
    ('government', false, 8),
    ('literature-in-english', false, 9),
    ('christian-religious-studies', false, 10),
    ('islamic-studies', false, 11),
    ('geography', false, 12),
    ('commerce', false, 13),
    ('principles-of-accounts', false, 14),
    ('history', false, 15),
    ('french', false, 16),
    ('hausa', false, 17),
    ('igbo', false, 18),
    ('yoruba', false, 19),
    ('arabic', false, 20),
    ('music', false, 21),
    ('fine-art', false, 22),
    ('home-economics', false, 23)
)
insert into public.exam_subjects (exam_body_id, subject_id, is_compulsory, display_order)
select jamb.id, s.id, os.is_compulsory, os.display_order
from jamb
join ordered_subjects os on true
join public.subjects s on s.slug = os.slug
on conflict (exam_body_id, subject_id) do update set
  is_compulsory = excluded.is_compulsory,
  display_order = excluded.display_order;
