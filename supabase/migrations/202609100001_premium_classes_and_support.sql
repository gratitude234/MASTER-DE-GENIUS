-- MASTER@DE'GENIUS Premium Classes Phase 1
-- Server-mediated tutoring leads, admin allowlist, consent evidence and atomic
-- 24-hour duplicate suppression. No question-provider data is referenced.

create type public.class_lead_status as enum ('new', 'contacted', 'interested', 'follow_up', 'enrolled', 'not_interested', 'closed');
create type public.class_type as enum ('group', 'private', 'topic_clinic', 'jamb_bootcamp', 'waec_bootcamp', 'mock_review', 'not_sure');
create type public.class_lead_source as enum ('class_page', 'result', 'progress', 'mistake_bank', 'topic_recommendation', 'subject_recommendation', 'persistent_support_cta', 'public_classes_cta', 'other');
create type public.contact_method as enum ('whatsapp', 'phone', 'email');
create type public.class_recommendation_reason as enum ('weak_topic', 'weak_subject', 'repeated_mistakes', 'student_requested');
create type public.marketing_channel as enum ('whatsapp', 'email');

create table public.app_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.premium_class_leads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  student_name text not null check (length(student_name) between 1 and 120),
  exam_type text not null check (exam_type in ('jamb', 'waec')),
  subject_slug text not null check (subject_slug ~ '^[a-z0-9-]+$'),
  subject_name text not null check (length(subject_name) between 1 and 120),
  topic text check (topic is null or length(topic) <= 160),
  class_type public.class_type not null,
  phone text not null check (phone ~ '^\+?[0-9]{10,15}$'),
  email text check (email is null or length(email) <= 254),
  preferred_contact_method public.contact_method not null,
  preferred_schedule text not null check (length(preferred_schedule) between 1 and 300),
  message text check (message is null or length(message) <= 1500),
  source public.class_lead_source not null,
  recommendation_reason public.class_recommendation_reason not null default 'student_requested',
  recent_accuracy smallint check (recent_accuracy is null or recent_accuracy between 0 and 100),
  fingerprint text not null check (length(fingerprint) = 64),
  status public.class_lead_status not null default 'new',
  assigned_to uuid references auth.users(id) on delete set null,
  admin_notes text check (admin_notes is null or length(admin_notes) <= 5000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  contacted_at timestamptz,
  enrolled_at timestamptz,
  closed_at timestamptz
);

create index premium_class_leads_user_created_idx on public.premium_class_leads (user_id, created_at desc);
create index premium_class_leads_crm_idx on public.premium_class_leads (status, created_at desc);
create index premium_class_leads_subject_idx on public.premium_class_leads (exam_type, subject_slug, class_type);
create index premium_class_leads_fingerprint_idx on public.premium_class_leads (user_id, fingerprint, created_at desc);

create table public.marketing_consents (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  channel public.marketing_channel not null,
  purpose text not null default 'classes_and_study_support' check (purpose = 'classes_and_study_support'),
  source_lead_id uuid references public.premium_class_leads(id) on delete set null,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (user_id, channel, purpose)
);

alter table public.app_admins enable row level security;
alter table public.premium_class_leads enable row level security;
alter table public.marketing_consents enable row level security;

revoke all on public.app_admins from public, anon, authenticated;
revoke all on public.premium_class_leads from public, anon, authenticated;
revoke all on public.marketing_consents from public, anon, authenticated;
-- Column-level grant, not a table-level one. RLS already limits rows to the
-- owner, but a table-wide grant would still let a student read their own
-- admin_notes, assigned_to and fingerprint straight from PostgREST with
-- the publishable key. CRM columns and internal lifecycle timestamps are
-- withheld from the browser role entirely; the server reads them as service_role.
grant select (
  id, user_id, exam_type, subject_slug, subject_name, topic, class_type,
  phone, email, preferred_contact_method, preferred_schedule, message,
  source, recommendation_reason, recent_accuracy, status, created_at
) on public.premium_class_leads to authenticated;
grant select on public.marketing_consents to authenticated;
grant all on public.app_admins, public.premium_class_leads, public.marketing_consents to service_role;
grant usage, select on sequence public.marketing_consents_id_seq to service_role;

create policy "class_leads_select_own"
on public.premium_class_leads for select to authenticated
using (user_id = auth.uid());

create policy "marketing_consents_select_own"
on public.marketing_consents for select to authenticated
using (user_id = auth.uid());

create or replace function public.create_premium_class_lead(
  p_user_id uuid,
  p_student_name text,
  p_exam_type text,
  p_subject_slug text,
  p_subject_name text,
  p_topic text,
  p_class_type public.class_type,
  p_phone text,
  p_email text,
  p_preferred_contact_method public.contact_method,
  p_preferred_schedule text,
  p_message text,
  p_source public.class_lead_source,
  p_recommendation_reason public.class_recommendation_reason,
  p_recent_accuracy smallint,
  p_fingerprint text
)
returns table (lead_id uuid, deduplicated boolean)
language plpgsql security definer set search_path = ''
as $$
declare v_existing uuid; v_id uuid;
begin
  if p_user_id is null then raise exception 'AUTHENTICATION_REQUIRED'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text || ':' || p_fingerprint, 0));
  select l.id into v_existing
  from public.premium_class_leads l
  where l.user_id = p_user_id and l.fingerprint = p_fingerprint
    and l.created_at >= now() - interval '24 hours'
    and l.status not in ('not_interested', 'closed')
  order by l.created_at desc limit 1;
  if v_existing is not null then return query select v_existing, true; return; end if;
  insert into public.premium_class_leads (
    user_id, student_name, exam_type, subject_slug, subject_name, topic, class_type,
    phone, email, preferred_contact_method, preferred_schedule, message, source,
    recommendation_reason, recent_accuracy, fingerprint
  ) values (
    p_user_id, p_student_name, p_exam_type, p_subject_slug, p_subject_name,
    nullif(trim(p_topic), ''), p_class_type, p_phone, nullif(trim(p_email), ''),
    p_preferred_contact_method, p_preferred_schedule, nullif(trim(p_message), ''),
    p_source, p_recommendation_reason, p_recent_accuracy, p_fingerprint
  ) returning id into v_id;
  return query select v_id, false;
end;
$$;

revoke all on function public.create_premium_class_lead(uuid,text,text,text,text,text,public.class_type,text,text,public.contact_method,text,text,public.class_lead_source,public.class_recommendation_reason,smallint,text) from public, anon, authenticated;
grant execute on function public.create_premium_class_lead(uuid,text,text,text,text,text,public.class_type,text,text,public.contact_method,text,text,public.class_lead_source,public.class_recommendation_reason,smallint,text) to service_role;
