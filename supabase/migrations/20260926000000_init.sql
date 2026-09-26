create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table public.allowlist (
  email text primary key check (email = lower(email) and email <> ''),
  role text not null check (role in ('admin', 'member')),
  added_at timestamptz not null default now(),
  constraint fixed_admin check ((role = 'admin') = (email = 'ardensdevspace@gmail.com'))
);
create unique index one_admin on public.allowlist (role) where role = 'admin';
insert into public.allowlist(email, role) values ('ardensdevspace@gmail.com', 'admin');

create table public.profiles (
  id uuid primary key references auth.users(id),
  email text not null,
  display_name text not null,
  avatar_url text,
  updated_at timestamptz not null default now()
);
create table public.batches (
  id uuid primary key default gen_random_uuid(),
  gmail_message_id text not null unique,
  received_at timestamptz not null,
  created_at timestamptz not null default now()
);
create table public.seen_posts (
  post_id text primary key check (post_id ~ '^[0-9]+$'),
  first_seen_at timestamptz not null default now()
);
create table public.materials (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.batches(id),
  kind text not null check (kind in ('parsed', 'raw')),
  status text not null default 'inbox' check (status in ('inbox', 'saved', 'trashed')),
  prev_status text check (prev_status in ('inbox', 'saved')),
  post_id text references public.seen_posts(post_id),
  url text,
  category text check (category in ('밈', '웃긴 게시물', '화제', '반응', '기타')),
  likes bigint check (likes >= 0),
  retweets bigint check (retweets >= 0),
  summary text,
  reason text,
  raw_text text,
  position integer not null check (position >= 0),
  created_at timestamptz not null default now(),
  saved_at timestamptz,
  trashed_at timestamptz,
  check ((kind = 'raw' and raw_text is not null and post_id is null and url is null and category is null)
      or (kind = 'parsed' and raw_text is null and post_id is not null and url is not null and category is not null)),
  check ((status = 'trashed' and prev_status is not null and trashed_at is not null)
      or (status <> 'trashed' and prev_status is null and trashed_at is null))
);
create index materials_batch_idx on public.materials(batch_id, position);
create index materials_status_idx on public.materials(status, saved_at desc, trashed_at desc);
create table public.comments (
  id uuid primary key default gen_random_uuid(),
  material_id uuid not null references public.materials(id) on delete cascade,
  author_id uuid not null references public.profiles(id),
  body text not null check (length(btrim(body)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz
);
create table public.ratings (
  material_id uuid not null references public.materials(id) on delete cascade,
  author_id uuid not null references public.profiles(id),
  score integer not null check (score between 1 and 5),
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  primary key(material_id, author_id)
);
create table public.board_revision (
  id integer primary key check (id = 1),
  revision bigint not null default 0
);
insert into public.board_revision(id) values (1);

create function private.member() returns boolean language sql stable security definer set search_path = '' as $$
  select (auth.jwt() -> 'app_metadata' ->> 'provider') = 'google'
    and exists (select 1 from public.allowlist where email = lower(auth.jwt() ->> 'email'))
$$;
create function private.admin() returns boolean language sql stable security definer set search_path = '' as $$
  select (auth.jwt() -> 'app_metadata' ->> 'provider') = 'google'
    and exists (select 1 from public.allowlist where email = lower(auth.jwt() ->> 'email') and role = 'admin')
$$;
revoke all on function private.member(), private.admin() from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.member(), private.admin() to authenticated;
create function public.is_member() returns boolean language sql stable security invoker set search_path = '' as $$
  select coalesce(private.member(), false)
$$;
create function public.is_admin() returns boolean language sql stable security invoker set search_path = '' as $$
  select coalesce(private.admin(), false)
$$;

create function private.profile_upsert() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles(id, email, display_name, avatar_url, updated_at)
  values (new.id, lower(new.email), coalesce(nullif(new.raw_user_meta_data ->> 'full_name',''), split_part(new.email, '@', 1)),
    new.raw_user_meta_data ->> 'avatar_url', now())
  on conflict (id) do update set email = excluded.email, display_name = excluded.display_name,
    avatar_url = excluded.avatar_url, updated_at = now();
  return new;
end $$;
create trigger profile_upsert after insert or update of email, raw_user_meta_data on auth.users
  for each row execute function private.profile_upsert();

create function private.protect_admin() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' and old.role = 'admin' then raise exception '관리자 계정은 제거할 수 없습니다'; end if;
  if tg_op = 'UPDATE' and (old.role = 'admin' or new.role = 'admin') then raise exception '관리자 계정은 변경할 수 없습니다'; end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
create trigger protect_admin before delete or update on public.allowlist
  for each row execute function private.protect_admin();

create function private.comment_guard() returns trigger language plpgsql security definer set search_path = '' as $$
declare mid uuid; state text;
begin
  mid := case when tg_op = 'DELETE' then old.material_id else new.material_id end;
  select status into state from public.materials where id = mid for update;
  if auth.role() = 'authenticated' and state is distinct from 'inbox' and state is distinct from 'saved' then
    raise exception '휴지통 소재에는 댓글을 변경할 수 없습니다';
  end if;
  if tg_op = 'UPDATE' then
    if new.material_id <> old.material_id or new.author_id <> old.author_id or new.created_at <> old.created_at then
      raise exception '댓글 소유 정보는 변경할 수 없습니다';
    end if;
    new.updated_at := now();
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
create trigger comment_guard before insert or update or delete on public.comments
  for each row execute function private.comment_guard();

create function private.rating_guard() returns trigger language plpgsql security definer set search_path = '' as $$
declare mid uuid; state text;
begin
  mid := case when tg_op = 'DELETE' then old.material_id else new.material_id end;
  select status into state from public.materials where id = mid for update;
  if auth.role() = 'authenticated' and state is distinct from 'inbox' and state is distinct from 'saved' then
    raise exception '휴지통 소재에는 별점을 변경할 수 없습니다';
  end if;
  if tg_op = 'UPDATE' then
    if new.material_id <> old.material_id or new.author_id <> old.author_id or new.created_at <> old.created_at then
      raise exception '별점 소유 정보는 변경할 수 없습니다';
    end if;
    new.updated_at := now();
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
create trigger rating_guard before insert or update or delete on public.ratings
  for each row execute function private.rating_guard();

create function private.bump_revision() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.board_revision set revision = revision + 1 where id = 1;
  return null;
end $$;
create trigger allowlist_revision after insert or update or delete on public.allowlist for each statement execute function private.bump_revision();
create trigger profiles_revision after insert or update or delete on public.profiles for each statement execute function private.bump_revision();
create trigger batches_revision after insert or update or delete on public.batches for each statement execute function private.bump_revision();
create trigger materials_revision after insert or update or delete on public.materials for each statement execute function private.bump_revision();
create trigger comments_revision after insert or update or delete on public.comments for each statement execute function private.bump_revision();
create trigger ratings_revision after insert or update or delete on public.ratings for each statement execute function private.bump_revision();

create function public.change_material(p_id uuid, p_expected_status text, p_action text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare m public.materials%rowtype;
begin
  if not private.member() then raise exception '팀원만 변경할 수 있습니다'; end if;
  select * into m from public.materials where id = p_id for update;
  if not found or m.status <> p_expected_status then return false; end if;
  if p_action = 'save' and m.status = 'inbox' then
    update public.materials set status = 'saved', saved_at = now() where id = p_id;
  elsif p_action = 'unsave' and m.status = 'saved' then
    update public.materials set status = 'inbox', saved_at = null where id = p_id;
  elsif p_action = 'trash' and m.status in ('inbox', 'saved') then
    update public.materials set status = 'trashed', prev_status = m.status, trashed_at = now() where id = p_id;
  elsif p_action = 'restore' and m.status = 'trashed' then
    update public.materials set status = m.prev_status, prev_status = null, trashed_at = null where id = p_id;
  else return false;
  end if;
  return true;
end $$;

create function public.ingest_batch(p_message_id text, p_received_at timestamptz, p_items jsonb, p_skipped integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare bid uuid; item jsonb; pid text; affected integer; parsed_count integer := 0; raw_count integer := 0; skipped_count integer := p_skipped;
begin
  if auth.role() <> 'service_role' then raise exception '권한이 없습니다'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_message_id, 0));
  select id into bid from public.batches where gmail_message_id = p_message_id;
  if found then return jsonb_build_object('status','duplicate','batchId',bid,'parsed',0,'raw',0,'skipped',0); end if;
  insert into public.batches(gmail_message_id, received_at) values (p_message_id, p_received_at) returning id into bid;
  for item in select value from jsonb_array_elements(p_items) order by (value ->> 'post_id') nulls first, (value ->> 'position')::integer loop
    pid := item ->> 'post_id';
    if item ->> 'kind' = 'parsed' then
      insert into public.seen_posts(post_id) values(pid) on conflict do nothing;
      get diagnostics affected = row_count;
      if affected = 0 then skipped_count := skipped_count + 1; continue; end if;
      parsed_count := parsed_count + 1;
    else
      raw_count := raw_count + 1;
    end if;
    insert into public.materials(batch_id, kind, post_id, url, category, likes, retweets, summary, reason, raw_text, position)
    values (bid, item ->> 'kind', pid, item ->> 'url', item ->> 'category', (item ->> 'likes')::bigint,
      (item ->> 'retweets')::bigint, item ->> 'summary', item ->> 'reason', item ->> 'raw_text', (item ->> 'position')::integer);
  end loop;
  return jsonb_build_object('status','created','batchId',bid,'parsed',parsed_count,'raw',raw_count,'skipped',skipped_count);
end $$;

create function private.purge_expired() returns integer language plpgsql security definer set search_path = '' as $$
declare m record; total integer := 0; affected integer;
begin
  for m in select id from public.materials where status = 'trashed' and trashed_at <= now() - interval '30 days' order by id loop
    perform 1 from public.materials where id = m.id for update;
    delete from public.materials where id = m.id and status = 'trashed' and trashed_at <= now() - interval '30 days';
    get diagnostics affected = row_count;
    total := total + affected;
  end loop;
  return total;
end $$;

alter table public.allowlist enable row level security;
alter table public.profiles enable row level security;
alter table public.batches enable row level security;
alter table public.seen_posts enable row level security;
alter table public.materials enable row level security;
alter table public.comments enable row level security;
alter table public.ratings enable row level security;
alter table public.board_revision enable row level security;

create policy members_read on public.allowlist for select to authenticated using (private.admin());
create policy admin_add on public.allowlist for insert to authenticated with check (private.admin() and role = 'member');
create policy admin_remove on public.allowlist for delete to authenticated using (private.admin() and role = 'member');
create policy members_read on public.profiles for select to authenticated using (private.member());
create policy members_read on public.batches for select to authenticated using (private.member());
create policy members_read on public.seen_posts for select to authenticated using (private.member());
create policy members_read on public.materials for select to authenticated using (private.member());
create policy members_read on public.comments for select to authenticated using (private.member());
create policy own_add on public.comments for insert to authenticated with check (private.member() and author_id = auth.uid());
create policy own_edit on public.comments for update to authenticated using (private.member() and author_id = auth.uid()) with check (private.member() and author_id = auth.uid());
create policy own_remove on public.comments for delete to authenticated using (private.member() and author_id = auth.uid());
create policy members_read on public.ratings for select to authenticated using (private.member());
create policy own_add on public.ratings for insert to authenticated with check (private.member() and author_id = auth.uid());
create policy own_edit on public.ratings for update to authenticated using (private.member() and author_id = auth.uid()) with check (private.member() and author_id = auth.uid());
create policy own_remove on public.ratings for delete to authenticated using (private.member() and author_id = auth.uid());
create policy members_read on public.board_revision for select to authenticated using (private.member());

revoke all on all tables in schema public from anon, authenticated;
grant select on public.allowlist, public.profiles, public.batches, public.materials, public.comments, public.ratings, public.board_revision to authenticated;
grant insert, delete on public.allowlist to authenticated;
grant insert, update, delete on public.comments, public.ratings to authenticated;
revoke all on function public.ingest_batch(text,timestamptz,jsonb,integer) from public, anon, authenticated;
grant execute on function public.ingest_batch(text,timestamptz,jsonb,integer) to service_role;
revoke all on function public.change_material(uuid,text,text) from public, anon;
grant execute on function public.change_material(uuid,text,text) to authenticated;
revoke all on function public.is_member(), public.is_admin() from public, anon;
grant execute on function public.is_member(), public.is_admin() to authenticated;
revoke all on function private.purge_expired() from public, anon, authenticated;

alter publication supabase_realtime add table public.board_revision;
create extension if not exists pg_cron with schema extensions;
select cron.schedule('purge-material-trash', '5 0 * * *', 'select private.purge_expired()');
