-- ForgePad is an owner-only application. Only its server service role can access these tables.
create table if not exists public.forgepad_questions (
  id text not null, version integer not null check(version > 0), payload jsonb not null,
  created_at timestamptz not null default now(), primary key(id,version)
);
create table if not exists public.forgepad_solutions (
  id text not null, version integer not null, payload jsonb not null,
  primary key(id,version), foreign key(id,version) references public.forgepad_questions(id,version)
);
create table if not exists public.forgepad_records (
  namespace text not null, key text not null, payload jsonb not null,
  revision bigint not null default 1,
  created_at timestamptz not null default now(), primary key(namespace,key)
);
create index if not exists forgepad_records_recent on public.forgepad_records(namespace,created_at desc);
create index if not exists forgepad_records_question on public.forgepad_records(namespace,(payload->>'question_id'));
create index if not exists forgepad_records_session on public.forgepad_records(namespace,(payload->>'session_id'));
alter table public.forgepad_questions enable row level security;
alter table public.forgepad_solutions enable row level security;
alter table public.forgepad_records enable row level security;
revoke all on public.forgepad_questions, public.forgepad_solutions, public.forgepad_records from anon, authenticated;
grant all on public.forgepad_questions, public.forgepad_solutions, public.forgepad_records to service_role;

create or replace function public.forgepad_publish_import(p_token text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare staged jsonb; q jsonb; latest integer;
begin
  select payload into staged from public.forgepad_records
    where namespace='imports' and key=p_token for update;
  if staged is null or (staged->>'created_at')::timestamptz < now() - interval '1 hour' then
    return jsonb_build_object('error','Validation token expired or was already published; validate again');
  end if;
  q := staged->'question';
  perform pg_advisory_xact_lock(hashtextextended(q->>'id',0));
  select max(version) into latest from public.forgepad_questions where id=q->>'id';
  if latest is not null and latest >= (q->>'version')::integer then
    return jsonb_build_object('error','A same or newer question version already exists');
  end if;
  insert into public.forgepad_questions(id,version,payload)
    values(q->>'id',(q->>'version')::integer,q - array['reference_solution','solution_notes','time_complexity','space_complexity']);
  insert into public.forgepad_solutions(id,version,payload)
    values(q->>'id',(q->>'version')::integer,jsonb_build_object(
      'reference_solution',q->'reference_solution','solution_notes',q->'solution_notes',
      'time_complexity',q->'time_complexity','space_complexity',q->'space_complexity'));
  delete from public.forgepad_records where namespace='imports' and key=p_token;
  return q;
end;
$$;
revoke all on function public.forgepad_publish_import(text) from public, anon, authenticated;
grant execute on function public.forgepad_publish_import(text) to service_role;
