import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { describe, expect, it } from "vitest";

const connectionString = process.env.TEST_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const card = (post_id: string, position = 0) => ({ kind: "parsed", post_id, position, url: `https://x.com/a/status/${post_id}`, category: "밈",
  post_text: "테스트", author_name: "작성자", author_handle: "a", image_url: null, likes: 1, replies: 0, posted_at: new Date().toISOString() });
const idNumber = () => `${Date.now()}${Math.floor(Math.random() * 1_000_000).toString().padStart(6, "0")}`;
async function client() { const db = new Client({ connectionString }); await db.connect(); return db; }
async function serviceCall(messageId: string, items: object[]) {
  const db = await client();
  try {
    await db.query("begin");
    await db.query("set local role service_role");
    await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ role: "service_role" })]);
    const result = await db.query("select public.ingest_batch($1, $2, $3::jsonb, 0) as result", [messageId, new Date().toISOString(), JSON.stringify(items)]);
    await db.query("commit");
    return result.rows[0].result as { status: string; batchId: string; parsed: number; skipped: number };
  } catch (error) { await db.query("rollback"); throw error; }
  finally { await db.end(); }
}

async function fixture() {
  const db = await client();
  const userId = randomUUID();
  const email = `test-${userId}@example.com`;
  const batchId = randomUUID();
  const materialId = randomUUID();
  try {
    await db.query("insert into auth.users(id,email,role,raw_user_meta_data) values($1,$2,'authenticated','{}')", [userId, email]);
    await db.query("insert into public.allowlist(email,role) values($1,'member')", [email]);
    await db.query("insert into public.batches(id,gmail_message_id,received_at) values($1,$2,now())", [batchId, `fixture-${randomUUID()}`]);
    await db.query("insert into public.materials(id,batch_id,kind,raw_text,position) values($1,$2,'raw','테스트 소재',0)", [materialId, batchId]);
    return { userId, email, materialId };
  } finally { await db.end(); }
}

async function memberClient(userId: string, email: string) {
  const db = await client();
  await db.query("begin");
  await db.query("set local role authenticated");
  await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: userId, role: "authenticated", email, app_metadata: { provider: "google" } })]);
  return db;
}

async function memberChange(userId: string, email: string, materialId: string, action: string) {
  const db = await memberClient(userId, email);
  try {
    const result = await db.query("select public.change_material($1,'inbox',$2) as applied", [materialId, action]);
    await db.query("commit");
    return result.rows[0].applied as boolean;
  } catch (error) { await db.query("rollback"); throw error; }
  finally { await db.end(); }
}

describe("메일 반영 트랜잭션", () => {
  it("같은 메일의 동시 호출을 회차 하나로 합친다", async () => {
    const message = `same-${randomUUID()}`;
    const [a, b] = await Promise.all([serviceCall(message, [card(idNumber())]), serviceCall(message, [card(idNumber())])]);
    expect([a.status, b.status].sort()).toEqual(["created", "duplicate"]);
    expect(a.batchId).toBe(b.batchId);
    const db = await client();
    try { expect((await db.query("select count(*)::int as n from public.batches where gmail_message_id = $1", [message])).rows[0].n).toBe(1); }
    finally { await db.end(); }
  });

  it("서로 다른 메일의 동일 게시물은 카드 하나만 만든다", async () => {
    const post = idNumber();
    const [a, b] = await Promise.all([serviceCall(`a-${randomUUID()}`, [card(post)]), serviceCall(`b-${randomUUID()}`, [card(post)])]);
    expect([a.parsed, b.parsed].sort()).toEqual([0, 1]);
    expect([a.skipped, b.skipped].sort()).toEqual([0, 1]);
    const db = await client();
    try { expect((await db.query("select count(*)::int as n from public.materials where post_id = $1", [post])).rows[0].n).toBe(1); }
    finally { await db.end(); }
  });

  it("중간 오류는 회차·게시물 기록을 전부 되돌려 재시도할 수 있다", async () => {
    const message = `rollback-${randomUUID()}`;
    const post = idNumber();
    await expect(serviceCall(message, [card(post), { ...card(idNumber(), 1), category: "잘못된 분류" }])).rejects.toThrow();
    const db = await client();
    try {
      expect((await db.query("select count(*)::int as n from public.batches where gmail_message_id = $1", [message])).rows[0].n).toBe(0);
      expect((await db.query("select count(*)::int as n from public.seen_posts where post_id = $1", [post])).rows[0].n).toBe(0);
    } finally { await db.end(); }
    expect((await serviceCall(message, [card(post)])).parsed).toBe(1);
  });
});

describe("소재 상태 경합", () => {
  it("동시에 저장·삭제하면 한 동작만 성공한다", async () => {
    const { userId, email, materialId } = await fixture();
    const results = await Promise.all([
      memberChange(userId, email, materialId, "save"), memberChange(userId, email, materialId, "trash"),
    ]);
    expect(results.sort()).toEqual([false, true]);
  });

  it("댓글이 먼저 확정되면 보존하고 휴지통 이동 뒤 댓글은 거부한다", async () => {
    const { userId, email, materialId } = await fixture();
    const writer = await memberClient(userId, email);
    try {
      await writer.query("insert into public.comments(material_id,author_id,body) values($1,$2,'먼저 쓴 댓글')", [materialId, userId]);
      const moving = memberChange(userId, email, materialId, "trash");
      await new Promise(resolve => setTimeout(resolve, 20));
      await writer.query("commit");
      expect(await moving).toBe(true);
    } finally { await writer.end(); }
    const db = await memberClient(userId, email);
    try {
      expect((await db.query("select count(*)::int as n from public.comments where material_id=$1", [materialId])).rows[0].n).toBe(1);
      await expect(db.query("insert into public.comments(material_id,author_id,body) values($1,$2,'늦게 쓴 댓글')", [materialId, userId])).rejects.toThrow();
      await db.query("rollback");
    } finally { await db.end(); }
  });
});
