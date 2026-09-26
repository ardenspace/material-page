alter table public.board_revision add column retention_days integer not null default 30 check (retention_days between 1 and 3650);

create or replace function private.purge_expired() returns integer language plpgsql security definer set search_path = '' as $$
declare m record; total integer := 0; affected integer; days integer;
begin
  select retention_days into days from public.board_revision where id = 1;
  for m in select id from public.materials where status = 'trashed' and trashed_at <= now() - make_interval(days => days) order by id loop
    perform 1 from public.materials where id = m.id for update;
    delete from public.materials where id = m.id and status = 'trashed' and trashed_at <= now() - make_interval(days => days);
    get diagnostics affected = row_count;
    total := total + affected;
  end loop;
  return total;
end $$;
