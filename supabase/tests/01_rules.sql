begin;
create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;
select plan(38);

insert into auth.users(id, email, role, raw_user_meta_data) values
('00000000-0000-0000-0000-000000000001', 'ardensdevspace@gmail.com', 'authenticated', '{"full_name":"관리자"}'),
('00000000-0000-0000-0000-000000000002', 'member@example.com', 'authenticated', '{"full_name":"팀원"}'),
('00000000-0000-0000-0000-000000000003', 'other@example.com', 'authenticated', '{"full_name":"다른 팀원"}'),
('00000000-0000-0000-0000-000000000004', 'stranger@example.com', 'authenticated', '{}');
insert into public.allowlist(email, role) values ('member@example.com', 'member'), ('other@example.com', 'member');
insert into public.batches(id, gmail_message_id, received_at) values ('10000000-0000-0000-0000-000000000001', 'test-mail', now());
insert into public.seen_posts(post_id) values ('100');
insert into public.materials(id, batch_id, kind, post_id, url, category, position) values
('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'parsed', '100', 'https://x.com/a/status/100', '밈', 0);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000004","role":"authenticated","email":"stranger@example.com","app_metadata":{"provider":"google"}}', true);
select is(public.is_member(), false, '미등록 계정 판정은 false');
select is((select count(*)::integer from public.materials where id = '20000000-0000-0000-0000-000000000001'), 0, '미등록 계정은 소재를 읽지 못함');
select throws_ok($$select public.change_material('20000000-0000-0000-0000-000000000001','inbox','save')$$);
select throws_ok($$insert into public.comments(material_id,author_id,body) values ('20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000004','못 씀')$$);

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated","email":"member@example.com","app_metadata":{"provider":"google"}}', true);
select is(public.is_member(), true, '등록 팀원 판정');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated","email":"member@example.com","app_metadata":{"provider":"email"}}', true);
select is(public.is_member(), false, '같은 이메일이어도 Google 로그인이 아니면 거부');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated","email":"member@example.com","app_metadata":{"provider":"google"}}', true);
select is((select count(*)::integer from public.materials where id = '20000000-0000-0000-0000-000000000001'), 1, '등록 팀원은 소재를 읽음');
select throws_ok($$insert into public.allowlist(email,role) values ('x@example.com','member')$$);
select throws_ok($$select public.ingest_batch('forbidden',now(),'[]'::jsonb,0)$$);
select is(public.change_material('20000000-0000-0000-0000-000000000001','inbox','save'), true, '저장 성공');
select is(public.change_material('20000000-0000-0000-0000-000000000001','inbox','trash'), false, '오래된 출발 상태의 삭제는 무효');
insert into public.comments(id, material_id, author_id, body) values ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', '내 댓글');
select throws_ok($$insert into public.ratings(material_id,author_id,score) values ('20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002',6)$$);
select throws_ok($$insert into public.ratings(material_id,author_id,score) values ('20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002',0)$$);
insert into public.ratings(material_id,author_id,score) values ('20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002',5);
select throws_ok($$insert into public.ratings(material_id,author_id,score) values ('20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002',4)$$);
select is(public.change_material('20000000-0000-0000-0000-000000000001','saved','trash'), true, '휴지통 이동');
select throws_ok($$insert into public.comments(material_id,author_id,body) values ('20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','휴지통 댓글')$$);
select throws_ok($$delete from public.ratings where material_id = '20000000-0000-0000-0000-000000000001'$$);
select is(public.change_material('20000000-0000-0000-0000-000000000001','trashed','restore'), true, '원래 저장됨으로 복구');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated","email":"other@example.com","app_metadata":{"provider":"google"}}', true);
update public.comments set body = '남의 댓글 변경' where id = '30000000-0000-0000-0000-000000000001';
select is((select body from public.comments where id = '30000000-0000-0000-0000-000000000001'), '내 댓글', '남의 댓글 수정 무효');
delete from public.comments where id = '30000000-0000-0000-0000-000000000001';
select is((select count(*)::integer from public.comments where id = '30000000-0000-0000-0000-000000000001'), 1, '남의 댓글 삭제 무효');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated","email":"ardensdevspace@gmail.com","app_metadata":{"provider":"google"}}', true);
delete from public.allowlist where email = 'member@example.com';
select is((select count(*)::integer from public.allowlist where email = 'member@example.com'), 0, '관리자 팀원 제거');
delete from public.allowlist where email = 'ardensdevspace@gmail.com';
select is((select count(*)::integer from public.allowlist where role = 'admin'), 1, '관리자 본인 제거 불가');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated","email":"member@example.com","app_metadata":{"provider":"google"}}', true);
select is(public.is_member(), false, '제거된 팀원 판정은 false');
select is((select count(*)::integer from public.materials where id = '20000000-0000-0000-0000-000000000001'), 0, '제거된 팀원은 기존 토큰으로도 읽지 못함');
select throws_ok($$select public.change_material('20000000-0000-0000-0000-000000000001','saved','trash')$$);

reset role;
select set_config('request.jwt.claims', '{}', true);
update public.materials set status = 'trashed', prev_status = 'saved', trashed_at = now() - interval '31 days'
  where id = '20000000-0000-0000-0000-000000000001';
insert into public.materials(id, batch_id, kind, raw_text, position, status, prev_status, trashed_at) values
('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','raw','29일 소재',1,'trashed','inbox',now() - interval '29 days');
select is(private.purge_expired(), 1, '31일 지난 소재만 삭제');
select is((select count(*)::integer from public.materials where id = '20000000-0000-0000-0000-000000000002'), 1, '29일 소재 보존');
select is((select count(*)::integer from public.comments where material_id = '20000000-0000-0000-0000-000000000001'), 0, '댓글 연쇄 삭제');
select is((select count(*)::integer from public.ratings where material_id = '20000000-0000-0000-0000-000000000001'), 0, '별점 연쇄 삭제');
select is((select count(*)::integer from public.seen_posts where post_id = '100'), 1, '영구 중복 기록 보존');
update public.board_revision set retention_days = 45 where id = 1;
select is(private.purge_expired(), 0, '보존 기간 조정 적용');

set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select is((public.ingest_batch('post-info-mail', now(), '[{"kind":"parsed","position":0,"post_id":"200","url":"https://x.com/abc/status/200","category":"밈","post_text":"본문","author_name":"작성자","author_handle":"abc","image_url":"https://pbs.twimg.com/media/a.jpg","likes":12,"replies":3,"posted_at":"2026-09-27T01:23:45.000Z"}]'::jsonb, 0) ->> 'parsed')::integer, 1, '게시물 정보 카드 저장');
select throws_ok($$select public.ingest_batch('bad-image-mail', now(), '[{"kind":"parsed","position":0,"post_id":"201","url":"https://x.com/abc/status/201","category":"밈","image_url":"https://evil.example/a.jpg"}]'::jsonb, 0)$$);
select throws_ok($$select public.ingest_batch('bad-replies-mail', now(), '[{"kind":"parsed","position":0,"post_id":"202","url":"https://x.com/abc/status/202","category":"밈","replies":-1}]'::jsonb, 0)$$);
select is(public.ingest_batch('no-link-mail', now(), '[]'::jsonb, 0) - 'batchId', '{"status":"created","parsed":0,"raw":0,"skipped":0}'::jsonb, '링크 없는 메일도 회차 생성');
reset role;
select set_config('request.jwt.claims', '{}', true);
select is((select row(post_text, author_name, author_handle, image_url, likes, replies, posted_at, retweets, summary, reason, raw_text)::text
  from public.materials where post_id = '200'),
  row('본문', '작성자', 'abc', 'https://pbs.twimg.com/media/a.jpg', 12::bigint, 3::bigint, '2026-09-27T01:23:45Z'::timestamptz,
    null::bigint, null::text, null::text, null::text)::text, '새 칸 저장, 예전 칸은 null');
select is((select count(*)::integer from public.batches where gmail_message_id = 'no-link-mail'), 1, '링크 없는 메일의 회차 행');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000004","role":"authenticated","email":"stranger@example.com","app_metadata":{"provider":"google"}}', true);
select is((select count(*)::integer from public.materials where post_id = '200'), 0, '미등록 계정은 새 카드를 읽지 못함');
reset role;

select * from finish();
rollback;
