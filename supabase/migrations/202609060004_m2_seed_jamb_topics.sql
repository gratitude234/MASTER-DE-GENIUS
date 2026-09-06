-- Starter JAMB topic taxonomy for the initial four-subject experience.
-- This taxonomy is intentionally product-level configuration, not a claim that
-- these labels reproduce the current official JAMB syllabus verbatim.
-- Reconcile against the active official syllabus/provider mappings before launch.

with topic_seed(subject_slug, topic_slug, topic_name, display_order) as (
  values
    ('use-of-english', 'comprehension', 'Comprehension', 1),
    ('use-of-english', 'lexis-and-structure', 'Lexis and Structure', 2),
    ('use-of-english', 'sentence-interpretation', 'Sentence Interpretation', 3),
    ('use-of-english', 'oral-forms', 'Oral Forms', 4),

    ('mathematics', 'number-and-numeration', 'Number and Numeration', 1),
    ('mathematics', 'algebra', 'Algebra', 2),
    ('mathematics', 'geometry', 'Geometry', 3),
    ('mathematics', 'trigonometry', 'Trigonometry', 4),
    ('mathematics', 'mensuration', 'Mensuration', 5),
    ('mathematics', 'statistics-and-probability', 'Statistics and Probability', 6),

    ('physics', 'measurements-and-units', 'Measurements and Units', 1),
    ('physics', 'motion', 'Motion', 2),
    ('physics', 'forces', 'Forces', 3),
    ('physics', 'work-energy-and-power', 'Work, Energy and Power', 4),
    ('physics', 'heat-and-thermal-physics', 'Heat and Thermal Physics', 5),
    ('physics', 'waves', 'Waves', 6),
    ('physics', 'light-and-optics', 'Light and Optics', 7),
    ('physics', 'electricity', 'Electricity', 8),
    ('physics', 'magnetism', 'Magnetism', 9),
    ('physics', 'modern-physics', 'Modern Physics', 10),

    ('chemistry', 'separation-and-purification', 'Separation and Purification', 1),
    ('chemistry', 'atomic-structure-and-bonding', 'Atomic Structure and Bonding', 2),
    ('chemistry', 'stoichiometry', 'Stoichiometry', 3),
    ('chemistry', 'states-of-matter', 'States of Matter', 4),
    ('chemistry', 'energetics', 'Energetics', 5),
    ('chemistry', 'acids-bases-and-salts', 'Acids, Bases and Salts', 6),
    ('chemistry', 'redox-and-electrochemistry', 'Redox and Electrochemistry', 7),
    ('chemistry', 'chemical-equilibrium', 'Chemical Equilibrium', 8),
    ('chemistry', 'periodicity', 'Periodicity', 9),
    ('chemistry', 'organic-chemistry', 'Organic Chemistry', 10)
)
insert into public.topics (subject_id, slug, name, display_order)
select s.id, ts.topic_slug, ts.topic_name, ts.display_order
from topic_seed ts
join public.subjects s on s.slug = ts.subject_slug
on conflict (subject_id, slug) do update set
  name = excluded.name,
  display_order = excluded.display_order,
  is_active = true;
