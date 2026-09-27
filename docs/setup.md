# 소재함 설치 안내

프로젝트는 Cloudflare Pages의 정적 파일, Supabase 데이터베이스·인증·Edge Function, 관리자 Gmail의 Apps Script로 동작한다. 서비스 설정과 OAuth 권한 승인은 각 계정 소유자가 직접 진행한다.

## 1. Supabase 프로젝트

1. Supabase 무료 프로젝트를 만든다. 프로젝트 URL과 publishable(또는 legacy anon) 키를 기록한다. 브라우저 코드에는 service role/secret 키를 넣지 않는다.
2. 프로젝트를 CLI에 연결한 뒤 저장소의 `supabase/migrations`를 적용한다. 예: `supabase login`, `supabase link --project-ref <프로젝트 ID>`, `supabase db push`. 첫 마이그레이션이 관리자 `ardensdevspace@gmail.com`을 허용 목록에 등록한다.
3. Database → Publications의 `supabase_realtime`에 `board_revision`만 있는지 확인한다. 업무 테이블은 구독하지 않는다.
4. Database → Cron에서 `purge-material-trash`가 매일 실행되도록 생성됐는지 확인한다. 휴지통 보존 기간 기본값은 30일이며, 필요하면 SQL Editor에서 `update public.board_revision set retention_days = <일수> where id = 1;`로 조정한다.

## 2. 구글 로그인

1. Google Cloud에서 OAuth 동의 화면과 웹 OAuth 클라이언트를 만든다.
2. Google의 **승인된 리디렉션 URI**에는 Supabase 대시보드가 표시하는 Auth callback URL인 `https://<프로젝트>.supabase.co/auth/v1/callback`을 등록한다.
3. Supabase Authentication → Providers → Google에 Google 클라이언트 ID와 비밀값을 입력해 활성화한다. 이메일·비밀번호 등 다른 로그인 제공자는 비활성화한다. DB 권한 함수도 Google 제공자 토큰만 팀원으로 인정한다.
4. Supabase Authentication → URL Configuration에서 Site URL을 `https://<보드 도메인>`으로 두고 Redirect URLs에 `https://<보드 도메인>/**` 및 로컬 개발 주소 `http://localhost:3000/**`를 추가한다. 보드가 로그인 뒤 돌아올 주소는 이 URL 설정에서 관리한다.
5. 관리자의 Google 계정으로 로그인한 뒤 팀원 관리 화면에서 팀원 이메일을 소문자 기준으로 추가한다.

## 3. 메일 수집 API

1. 추측하기 어려운 긴 `INGEST_SECRET` 값을 생성해 Supabase Edge Function secret으로 설정한다. 예: `supabase secrets set INGEST_SECRET=<값>`.
2. `supabase functions deploy ingest --no-verify-jwt`로 배포한다. `supabase/config.toml`에도 JWT 검사를 끄는 설정이 있다.
3. 함수 주소는 `https://<프로젝트>.supabase.co/functions/v1/ingest`다. 이 주소와 위 비밀값은 Gmail Apps Script의 속성으로만 보관한다. service role 키는 Supabase 런타임의 `SUPABASE_SERVICE_ROLE_KEY`를 사용한다.

## 4. Cloudflare Pages

1. 이 저장소를 Cloudflare Pages에 연결한다. 빌드 명령은 `pnpm build`, 출력 폴더는 `out`이다. 정적 내보내기 설정이 있으므로 Workers/SSR 어댑터는 사용하지 않는다.
2. 빌드 환경 변수 `NEXT_PUBLIC_SUPABASE_URL`과 `NEXT_PUBLIC_SUPABASE_ANON_KEY`에 Supabase URL과 공개 키를 넣는다. `INGEST_SECRET`은 Pages에 설정하지 않는다.
3. 배포 후 사용자 도메인을 연결하고, 그 도메인을 2장의 Supabase Redirect URLs에 추가한다.

## 5. Gmail Apps Script

1. 관리자 Gmail 계정에서 Apps Script 프로젝트를 만들고 `gmail-script/Code.gs`와 `gmail-script/appsscript.json`을 복사한다.
2. 스크립트 속성에 `INGEST_URL`(3장의 함수 주소), `INGEST_SECRET`(3장의 비밀값)을 등록한다. 코드를 공개해도 비밀값이 보이지 않도록 속성에만 둔다.
3. `installTrigger`를 한 번 실행해 KST 오전·오후 일일 트리거 두 개를 만들고 Gmail 읽기·외부 요청 권한을 승인한다. 이전 10분 반복 트리거가 같은 함수를 실행 중이었다면 이 설치 함수가 제거한다. `forwardGrokMail`을 수동 실행해 최초 동작을 확인한다.
   Apps Script의 `nearMinute(25)`는 ±15분 오차가 있어 오전 8:10~8:40, 오후 8:10~8:40 사이 시작을 예상한다. 정확히 8:10에 시작한다는 보장은 없다. 메일이 그 실행보다 늦게 오면 다음 예약 실행에서 수집한다.
4. 선별 기준은 메일 **제목이 `강원도 밈`으로 시작**하는 것이다(앞뒤 공백 제외). Grok 메일 제목의 뒷부분이 회차마다 달라서 공통 앞부분으로 고른다. 본문 양식이 틀려도 전송되며, 보드에는 원문 카드가 생긴다.
5. 최초 실행은 최근 3일에서 시작한다. 이후 `COMPLETED_UNTIL_MS` 스크립트 속성에 저장된 완료 지점부터 재개하므로 중단이 3일을 넘어도 원본 메일이 Gmail에 남아 있으면 따라잡는다. 이 값을 현재 시각으로 임의 변경하면 미처리 메일이 누락된다.
6. 실행 로그에 `전달 실패`가 나오면 API 주소·비밀값·Supabase 상태를 확인하고 `forwardGrokMail`을 다시 실행한다. 성공한 메일이 다시 전송돼도 서버가 중복 회차를 만들지 않는다. Gmail에서 원본이 영구 삭제되면 수집할 수 없다.

## 6. Grok 예약 요청

기존 강원도 소재 검색 지시 끝에 다음 문장을 그대로 붙인다.

```
결과는 다른 말 없이, 한 줄에 게시물 하나씩 "분류 링크" 형식으로만 써줘.
분류는 밈 / 웃긴 / 화제 / 반응 중 하나로 쓰고, 링크는 x.com 게시물 주소 전체를 써줘.
소개글, 번호, 요약, 설명은 쓰지 마.
예) 밈 https://x.com/아이디/status/게시물번호
```

Grok은 링크만 보내고, 작성자·본문·사진·좋아요·댓글 수·작성 시각은 메일 수집 API가 X의 공개 조회 주소에서 가져온다. 게시물 정보를 가져오지 못하면 분류와 원본 링크만 있는 카드가 생긴다. 링크가 없는 메일은 카드를 만들지 않고 회차 기록만 남긴다. 메일이 잘려 `Continue reading`이 붙으면 마지막 링크는 번호가 잘렸을 수 있어서 버린다. 예시 줄의 링크는 숫자가 아니어서 요청문이 메일에 인용되어도 카드가 생기지 않는다.

**교체 시점**: DB 마이그레이션 적용, `ingest` 함수 배포, 사이트 배포(`main` push)가 끝나면 바로 이 문장으로 교체한다. 새 해석기는 이 한 줄 양식만 읽기 때문에, 교체 전에 들어오는 옛 양식 메일은 분류가 '기타'로 들어오거나 링크가 없어 카드가 생기지 않을 수 있다. 그렇게 생긴 카드는 그대로 둔다. 배포와 교체는 수집 시각(한국 시간 오전·오후 8~9시)을 피한다.

**확인 방법**: 교체 뒤 첫 실제 메일 1통에서 메일 속 링크 수와 카드 수가 맞는지(잘린 메일은 마지막 링크 1개가 빠짐), 작성자·본문·사진·수치가 보이는지, `원본 보기 ↗`가 게시물로 이동하는지, 본문이나 작성자로 검색되는지 확인한다. 오전·오후 예약 실행 뒤 회차가 나타나는지, 메일 도착과 스크립트 실행 시각을 함께 확인한다. 실시간 갱신은 두 팀원 계정으로 저장·댓글·별점을 바꿔 확인한다. Supabase 무료 프로젝트의 일시 중지는 서비스 상태에 따라 달라질 수 있으니 프로젝트 대시보드에서 확인한다.

## 로컬 검증

Node.js 24, pnpm, Docker, Supabase CLI를 준비하고 `pnpm install`, `supabase start`, `supabase db reset --local`, `pnpm verify`를 실행한다. 개발 서버에는 `.env.local`에 `NEXT_PUBLIC_SUPABASE_URL`과 `NEXT_PUBLIC_SUPABASE_ANON_KEY`를 넣는다. `INGEST_SECRET`은 로컬 Edge Function 실행 환경에 별도로 설정한다.
