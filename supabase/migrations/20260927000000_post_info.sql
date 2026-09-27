alter table public.materials
  add column post_text text,
  add column author_name text,
  add column author_handle text,
  add column image_url text check (image_url is null or image_url like 'https://pbs.twimg.com/%'),
  add column replies bigint check (replies >= 0),
  add column posted_at timestamptz;

create or replace function public.ingest_batch(p_message_id text, p_received_at timestamptz, p_items jsonb, p_skipped integer)
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
    insert into public.materials(batch_id, kind, post_id, url, category, post_text, author_name, author_handle, image_url,
      likes, replies, posted_at, raw_text, position)
    values (bid, item ->> 'kind', pid, item ->> 'url', item ->> 'category', item ->> 'post_text', item ->> 'author_name',
      item ->> 'author_handle', item ->> 'image_url', (item ->> 'likes')::bigint, (item ->> 'replies')::bigint,
      (item ->> 'posted_at')::timestamptz, case when item ->> 'kind' = 'raw' then item ->> 'raw_text' end,
      (item ->> 'position')::integer);
  end loop;
  return jsonb_build_object('status','created','batchId',bid,'parsed',parsed_count,'raw',raw_count,'skipped',skipped_count);
end $$;

revoke all on function public.ingest_batch(text,timestamptz,jsonb,integer) from public, anon, authenticated;
grant execute on function public.ingest_batch(text,timestamptz,jsonb,integer) to service_role;
