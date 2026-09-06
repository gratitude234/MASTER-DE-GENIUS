-- M6: atomic optimistic concurrency and retry receipts. Service-only boundary.
create table public.response_revisions (
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('exam', 'practice')),
  session_id uuid not null,
  question_id uuid not null,
  revision integer not null check (revision > 0),
  mutation_id uuid not null,
  receipt jsonb not null,
  primary key (user_id, kind, session_id, question_id)
);
alter table public.response_revisions enable row level security;
revoke all on public.response_revisions from public, anon, authenticated;
grant select, insert, update, delete on public.response_revisions to service_role;

create or replace function public.save_response_v2(
  p_user_id uuid, p_kind text, p_session_id uuid, p_question_id uuid,
  p_selected_option_key text, p_is_flagged boolean,
  p_expected_revision integer, p_mutation_id uuid
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_previous public.response_revisions%rowtype;
  v_payload jsonb;
  v_revision integer;
begin
  if p_expected_revision is null or p_expected_revision < 0 or p_mutation_id is null then
    raise exception 'INVALID_REVISION';
  end if;
  -- Same lock used by the original save/finalisation RPCs. No read/write race.
  if p_kind = 'exam' then
    perform 1 from public.exam_attempts where id = p_session_id and user_id = p_user_id for update;
  elsif p_kind = 'practice' then
    perform 1 from public.practice_sessions where id = p_session_id and user_id = p_user_id for update;
  else raise exception 'INVALID_SESSION_KIND';
  end if;
  if not found then raise exception 'SESSION_NOT_FOUND'; end if;

  select * into v_previous from public.response_revisions
  where user_id = p_user_id and kind = p_kind and session_id = p_session_id and question_id = p_question_id;
  if found and v_previous.mutation_id = p_mutation_id then
    -- Identical retry after a lost acknowledgement: no re-evaluation or second write.
    return v_previous.receipt;
  end if;
  v_revision := coalesce(v_previous.revision, 0);
  if v_revision <> p_expected_revision then raise exception 'RESPONSE_CONFLICT'; end if;

  if p_kind = 'exam' then
    select to_jsonb(r) into v_payload from public.save_exam_response(
      p_user_id, p_session_id, p_question_id, p_selected_option_key, p_is_flagged) r;
  else
    select to_jsonb(r) into v_payload from public.save_practice_answer(
      p_user_id, p_session_id, p_question_id, p_selected_option_key) r;
  end if;
  v_payload := v_payload || jsonb_build_object('revision', v_revision + 1, 'mutation_id', p_mutation_id);
  insert into public.response_revisions values (p_user_id, p_kind, p_session_id, p_question_id, v_revision + 1, p_mutation_id, v_payload)
  on conflict (user_id, kind, session_id, question_id) do update
    set revision = excluded.revision, mutation_id = excluded.mutation_id, receipt = excluded.receipt;
  return v_payload;
end;
$$;
revoke all on function public.save_response_v2(uuid,text,uuid,uuid,text,boolean,integer,uuid) from public, anon, authenticated;
grant execute on function public.save_response_v2(uuid,text,uuid,uuid,text,boolean,integer,uuid) to service_role;
