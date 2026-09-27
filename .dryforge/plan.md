# plan — Grok 메일 "분류 링크" 양식 전환과 게시물 정보 자동 조회

`spec.md`를 구현하는 작업 목록이다. 잠정적인 설계도이므로 필요하면 고쳐도 된다. 동작의 기준은 언제나 spec이다.

## 준비 작업

없음. 기존 프로젝트 구조(Next.js 정적 내보내기, `supabase/`, vitest, `pnpm verify`)를 그대로 쓴다.
로컬 검증 전에 `supabase start`와 `supabase db reset --local`로 새 마이그레이션을 적용한다.

## 작업

### T1 — DB: 칸 추가와 `ingest_batch` 변경 (spec 6장)
- **대상 파일**: 새 `supabase/migrations/20260927000000_post_info.sql`, `supabase/tests/01_rules.sql`,
  `tests/db-concurrency.test.ts`
- **동작 계약**
  - `materials`에 spec 6.1의 칸 6개와 제약 2개(`image_url` 주소 앞부분, `replies >= 0`)를 추가한다. 기존 칸·제약·데이터는
    건드리지 않는다.
  - `ingest_batch`를 같은 이름·매개변수로 `create or replace`한다. 잠금, 멱등, 중복 판정, 정렬 순서, 반환 형식, 권한
    검사는 기존 본문을 그대로 옮기고, 저장 칸만 spec 6.2대로 바꾼다. `replies`·`likes`는 bigint로, `posted_at`은
    timestamptz로 변환한다.
  - `create or replace` 뒤에 기존과 같은 revoke/grant 문을 다시 적어서 실행 권한이 서비스 권한에만 있게 한다.
  - `posted_at` 변환 실패나 `image_url` 제약 위반은 메일 전체의 500으로 이어진다. 값의 형식은 T3가 보장하며(ISO 시각
    또는 null, pbs 주소 또는 null), DB 쪽 변환과 제약은 마지막 방어선이다.
- **검증**
  - DB 테스트: `service_role`로 `ingest_batch`를 호출해서(기존 `tests/db-concurrency.test.ts`의 호출 방식 참고,
    pgTAP에서는 `set local role service_role`과 `request.jwt.claims` 설정) 새 칸이 저장되고 `retweets/summary/reason`이 null인지, pbs가 아닌 `image_url`과 음수 `replies`가 거부되는지,
    팀원이 아닌 사용자가 새 칸을 읽을 수 없는지(기존 규칙 적용).
    `plan(N)` 개수를 갱신한다
  - 동시성 테스트의 테스트 카드를 새 계약 모양으로 바꾸고 기존 검증(멱등, 다른 메일의 같은 게시물, 롤백)이 통과
  - `pnpm verify`

### T2 — 해석기 교체 (spec 4장)
- **대상 파일**: `supabase/functions/_shared/parse.ts`, `tests/parser.test.ts`, `tests/ingest.test.ts`(본문 예시만 새 한 줄
  양식으로 바꾼다. 해석기를 바꾸면 기존 예시가 카드 0개가 되어 이 작업의 검증이 실패하기 때문이다)
- **동작 계약**
  - `===강원소재===` 양식 해석 코드를 모두 지우고 spec 4장의 규칙 1~6을 구현한다.
  - 반환 형식은 `{ cards: ParsedCard[]; skipped: number }`. `ParsedCard`는 spec 4장의 조회 전 카드 모양이며 T3가
    이 형식을 가져다 쓴다. `RawCard` 형식은 해석기에서 없앤다.
  - 외부 의존 없는 TypeScript를 유지한다(Deno와 vitest에서 모두 불러온다).
- **검증**: spec 10장의 해석기 항목을 테스트로 쓴다. 기존 링크 변형 테스트(`twitter.com`, `mobile.`, 쿼리, `/photo/1`)는
  한 줄 양식으로 옮겨 유지한다. `pnpm verify`

### T3 — 게시물 정보 조회와 입구 API 연결 (spec 5장, 6.3)
- **대상 파일**: 새 `supabase/functions/_shared/post.ts`(조회와 응답 변환), `supabase/functions/ingest/handler.ts`,
  `supabase/functions/ingest/index.ts`, `tests/ingest.test.ts`, 새 `tests/post.test.ts`
- **동작 계약**
  - 조회 함수는 `fetch`를 인자로 받아서 테스트에서 가짜로 바꿀 수 있게 한다. 요청마다 5초 제한(`AbortSignal.timeout`
    등, 값은 조정 가능)을 건다.
  - 카드 목록을 받아 모두 동시에 조회하고, 각 카드에 spec 5장의 칸을 채운 저장용 항목(spec 6.2 모양)을 돌려준다.
    이 함수는 어떤 경우에도 예외를 밖으로 던지지 않는다.
  - `handleIngest`는 인증·입력 검증 뒤 해석 → 조회 → 저장 순서로 진행한다. 조회 함수는 `handleIngest`에 주입한다
    (기존 `save` 주입 방식과 같게). 저장 실패만 500이다.
  - 링크가 없어도 저장 함수를 빈 목록으로 호출해서 회차 행을 만든다.
  - `index.ts`는 실제 `fetch`를 쓰는 조회 함수를 연결하고, 새 항목을 그대로 `ingest_batch`에 넘긴다.
- **검증**: spec 10장의 조회·입구 API 항목. `pnpm verify`

### T4 — 카드 화면과 검색 (spec 7장)
- **대상 파일**: `src/lib/model.ts`, `src/components/Board.tsx`, 필요하면 `src/app/globals.css`
- **동작 계약**
  - `Material` 형식에 새 칸 6개를 추가한다.
  - spec 7.1의 판별로 예전 카드, 새 카드, 조회 실패 카드를 나눠 그린다. 예전 카드의 마크업과 모양은 바꾸지 않는다.
  - 새 카드는 spec 7.2의 순서를 따른다. 사진은 Next 이미지 최적화 없이 일반 `<img>`로 표시한다(정적 내보내기). 이때 나오는 린트 경고
    `@next/next/no-img-element`는 그 줄에만 끄는 주석으로 처리한다.
    사진을 불러오지 못하면 숨긴다.
  - 검색 대상과 안내 문구를 spec 7.4대로 바꾼다.
  - 새 스타일은 기존 카드 스타일(색, 간격, 글꼴)에 맞추고, 휴대폰 폭에서 사진이 카드 밖으로 넘치지 않게 한다.
- **검증**: `pnpm verify`(타입, 린트, 빌드). 화면은 사람이 확인하므로 자동 화면 테스트는 만들지 않는다.

### T5 — 안내서의 Grok 요청 문장 교체 (spec 3장)
- **대상 파일**: `docs/setup.md` 6장
- **동작 계약**: 옛 양식 문장을 spec 3장의 문장으로 바꾸고, 배포 직후 교체해야 하는 이유와 교체 전 메일은 '기타'로
  들어올 수 있다는 점, 확인 방법(실제 메일 1통의 카드 수와 표시)을 적는다. 옛 양식 설명은 지운다.
- **검증**: 문서에 `===강원소재===`가 남아 있지 않다. `pnpm verify`

### T6 — 배포 (spec 9장)
- **대상**: 원격 Supabase 프로젝트(이미 CLI에 연결됨), Supabase Edge Function `ingest`, GitHub `origin/main`
  (Cloudflare Pages가 연결되어 있음)
- **동작 계약**
  - 모든 작업이 병합되고 `pnpm verify`가 통과한 뒤에만 진행한다.
  - 현재 한국 시간이 오전·오후 8~9시이면 그 시간이 지날 때까지 기다린다.
  - 아래 세 명령을 이 순서로, **각각 실행 직전에 사용자 확인을 받고** 실행한다. 한 단계가 실패하면 멈추고 알린다.
    1. `supabase db push`
    2. `supabase functions deploy ingest --no-verify-jwt`
    3. `git push origin main`
  - 끝나면 사용자에게 Grok 요청 문장을 지금 바로 교체하라고 안내하고, 교체할 문장(spec 3장)을 보여 준다.
- **검증 증거**: 세 명령의 성공 출력. 실제 메일 확인은 사용자가 한다.

## 공유 파일 안내

- T2와 T3는 `ParsedCard` 형식과 `tests/ingest.test.ts`를 공유한다. T3는 T2가 끝난 뒤 시작하므로 충돌하지 않는다.
  T3는 `parse.ts`를 고치지 않는다.
- T1과 T4는 서로 다른 파일만 고친다. DB 타입 생성 파일은 없으므로 재생성 단계도 없다.

## 실행 그래프

```yaml
tasks:
  - id: T1
    depends: []
    risk: RISKY
  - id: T2
    depends: []
    risk: RISKY
  - id: T3
    depends: [T2]
    risk: RISKY
  - id: T4
    depends: []
    risk: MECHANICAL
  - id: T5
    depends: []
    risk: NONE
  - id: T6
    depends: [T1, T3, T4, T5]
    risk: RISKY
regen_barriers: []
```

## 요구사항 추적

| spec | 작업 |
|---|---|
| 3장 Grok 요청 문장 | T5 |
| 4장 해석 규칙 | T2 |
| 5장 조회 | T3 |
| 6.1 칸 추가 | T1 (형식은 T4) |
| 6.2 `ingest_batch` | T1 (항목 생성은 T3) |
| 6.3 응답 유지 | T3 |
| 7장 화면·검색 | T4 |
| 8장 예외 | T2, T3, T1 |
| 9장 배포 | T6 |
| 10장 검증 | T1~T4 |
