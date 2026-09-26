import { randomUUID, createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import { Client } from "pg";
import { createClient } from "@supabase/supabase-js";
import { expect, it } from "vitest";

const database = process.env.TEST_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
function localEnv(): Record<string, string> {
  const output = execFileSync("supabase", ["status", "-o", "env"], { encoding: "utf8" });
  return Object.fromEntries(output.split("\n").filter(line => line.includes("=")).map(line => {
    const index = line.indexOf("=");
    return [line.slice(0, index), line.slice(index + 1).replace(/^"|"$/g, "")];
  }));
}
function jwt(secret: string, id: string, email: string): string {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const content = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ aud: "authenticated", role: "authenticated", sub: id, email, app_metadata: { provider: "google" },
    iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 })}`;
  return `${content}.${createHmac("sha256", secret).update(content).digest("base64url")}`;
}

it("제거된 팀원의 기존 Realtime 연결과 DB 읽기를 차단한다", async () => {
  const env = localEnv();
  const db = new Client({ connectionString: database });
  await db.connect();
  const id = randomUUID();
  const email = `realtime-${id}@example.com`;
  await db.query("insert into auth.users(id,email,role,raw_user_meta_data) values($1,$2,'authenticated','{}')", [id, email]);
  await db.query("insert into public.allowlist(email,role) values($1,'member')", [email]);
  const token = jwt(env.JWT_SECRET, id, email);
  const api = createClient(env.API_URL, env.ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false },
  });
  api.realtime.setAuth(token);
  let signals = 0;
  let signalReceived: (() => void) | undefined;
  const channel = api.channel(`test-${id}`).on("postgres_changes", { event: "UPDATE", schema: "public", table: "board_revision" }, () => {
    signals++;
    signalReceived?.();
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Realtime 연결 실패")), 10_000);
      channel.subscribe(status => { if (status === "SUBSCRIBED") { clearTimeout(timer); resolve(); } });
    });
    let baselineReceived = false;
    for (let attempt = 0; attempt < 5 && !baselineReceived; attempt++) {
      const received = new Promise<boolean>(resolve => {
        const timer = setTimeout(() => resolve(false), 2_000);
        signalReceived = () => { clearTimeout(timer); resolve(true); };
      });
      await db.query("update public.board_revision set revision=revision+1 where id=1");
      baselineReceived = await received;
    }
    expect(baselineReceived).toBe(true);
    signalReceived = undefined;
    await db.query("delete from public.allowlist where email=$1", [email]);
    const before = signals;
    await db.query("update public.board_revision set revision=revision+1 where id=1");
    await new Promise(resolve => setTimeout(resolve, 500));
    expect(signals).toBe(before);
    const { data: member, error: checkError } = await api.rpc("is_member");
    expect(checkError).toBeNull();
    expect(member).toBe(false);
    const { data: materials, error: readError } = await api.from("materials").select("id");
    expect(readError).toBeNull();
    expect(materials).toEqual([]);
  } finally {
    await api.removeChannel(channel);
    await db.end();
  }
}, 30_000);
