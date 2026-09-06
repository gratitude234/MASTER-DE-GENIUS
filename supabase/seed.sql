-- Optional local-development seed content.
-- These are original demonstration questions written for the app; they are not
-- represented as past JAMB/WAEC/NECO questions and carry no historical year.

DO $$
declare
  v_exam uuid;
  v_subject uuid;
  v_topic uuid;
  v_question uuid;
begin
  select id into v_exam from public.exam_bodies where code = 'jamb';

  -- Use of English
  select id into v_subject from public.subjects where slug = 'use-of-english';
  select id into v_topic from public.topics where subject_id = v_subject and slug = 'lexis-and-structure';
  select id into v_question from public.questions where source_provider = 'internal' and source_question_id = 'demo-english-001';
  if v_question is null then
    insert into public.questions (
      exam_body_id, subject_id, topic_id, question_text, correct_option_key,
      explanation, difficulty, source_provider, source_question_id, status
    ) values (
      v_exam, v_subject, v_topic,
      'Choose the option nearest in meaning to the word concise.',
      'B', 'Concise means brief while still giving the necessary information.',
      'easy', 'internal', 'demo-english-001', 'draft'
    ) returning id into v_question;
    insert into public.question_options (question_id, option_key, option_text, display_order) values
      (v_question, 'A', 'confusing', 1),
      (v_question, 'B', 'brief', 2),
      (v_question, 'C', 'careless', 3),
      (v_question, 'D', 'repetitive', 4);
    update public.questions set status = 'active' where id = v_question;
  end if;

  -- Mathematics
  select id into v_subject from public.subjects where slug = 'mathematics';
  select id into v_topic from public.topics where subject_id = v_subject and slug = 'algebra';
  select id into v_question from public.questions where source_provider = 'internal' and source_question_id = 'demo-maths-001';
  if v_question is null then
    insert into public.questions (
      exam_body_id, subject_id, topic_id, question_text, correct_option_key,
      explanation, difficulty, source_provider, source_question_id, status
    ) values (
      v_exam, v_subject, v_topic,
      'If 3x + 5 = 20, what is the value of x?',
      'C', 'Subtract 5 from both sides to get 3x = 15, then divide by 3.',
      'easy', 'internal', 'demo-maths-001', 'draft'
    ) returning id into v_question;
    insert into public.question_options (question_id, option_key, option_text, display_order) values
      (v_question, 'A', '3', 1),
      (v_question, 'B', '4', 2),
      (v_question, 'C', '5', 3),
      (v_question, 'D', '6', 4);
    update public.questions set status = 'active' where id = v_question;
  end if;

  -- Physics
  select id into v_subject from public.subjects where slug = 'physics';
  select id into v_topic from public.topics where subject_id = v_subject and slug = 'waves';
  select id into v_question from public.questions where source_provider = 'internal' and source_question_id = 'demo-physics-001';
  if v_question is null then
    insert into public.questions (
      exam_body_id, subject_id, topic_id, question_text, correct_option_key,
      explanation, difficulty, source_provider, source_question_id, status
    ) values (
      v_exam, v_subject, v_topic,
      'A wave has a frequency of 5 Hz. What is its period?',
      'B', 'Period T = 1/f, so T = 1/5 = 0.2 s.',
      'easy', 'internal', 'demo-physics-001', 'draft'
    ) returning id into v_question;
    insert into public.question_options (question_id, option_key, option_text, display_order) values
      (v_question, 'A', '0.1 s', 1),
      (v_question, 'B', '0.2 s', 2),
      (v_question, 'C', '2 s', 3),
      (v_question, 'D', '5 s', 4);
    update public.questions set status = 'active' where id = v_question;
  end if;

  -- Chemistry
  select id into v_subject from public.subjects where slug = 'chemistry';
  select id into v_topic from public.topics where subject_id = v_subject and slug = 'organic-chemistry';
  select id into v_question from public.questions where source_provider = 'internal' and source_question_id = 'demo-chemistry-001';
  if v_question is null then
    insert into public.questions (
      exam_body_id, subject_id, topic_id, question_text, correct_option_key,
      explanation, difficulty, source_provider, source_question_id, status
    ) values (
      v_exam, v_subject, v_topic,
      'Methane (CH₄) belongs to which homologous series?',
      'A', 'Methane is the simplest member of the alkane homologous series.',
      'easy', 'internal', 'demo-chemistry-001', 'draft'
    ) returning id into v_question;
    insert into public.question_options (question_id, option_key, option_text, display_order) values
      (v_question, 'A', 'Alkanes', 1),
      (v_question, 'B', 'Alkenes', 2),
      (v_question, 'C', 'Alcohols', 3),
      (v_question, 'D', 'Carboxylic acids', 4);
    update public.questions set status = 'active' where id = v_question;
  end if;
end;
$$;
