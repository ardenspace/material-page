import { parseMail } from "../_shared/parse.ts";

export type IngestResult = { status: "created" | "duplicate"; batchId: string; parsed: number; raw: number; skipped: number };
type Save = (messageId: string, receivedAt: string, cards: ReturnType<typeof parseMail>["cards"], skipped: number) => Promise<IngestResult>;

async function validSecret(actual: string, expected: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const digest = async (value: string) => new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
  const [a, b] = await Promise.all([digest(actual), digest(expected)]);
  let different = 0;
  for (let i = 0; i < a.length; i++) different |= a[i] ^ b[i];
  return different === 0 && actual.length > 0 && expected.length > 0;
}

function json(value: unknown, status: number): Response {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
}

export async function handleIngest(request: Request, secret: string, save: Save): Promise<Response> {
  const auth = request.headers.get("Authorization") ?? "";
  const provided = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!(await validSecret(provided, secret))) return json({ error: "Unauthorized" }, 401);
  let input: unknown;
  try { input = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  if (!input || typeof input !== "object") return json({ error: "Invalid body" }, 400);
  const { messageId, receivedAt, body } = input as Record<string, unknown>;
  if (typeof messageId !== "string" || !messageId.trim() || typeof receivedAt !== "string" ||
      !receivedAt.trim() || Number.isNaN(Date.parse(receivedAt)) || typeof body !== "string" || !body.trim()) {
    return json({ error: "Invalid body" }, 400);
  }
  const parsed = parseMail(body);
  try {
    return json(await save(messageId, receivedAt, parsed.cards, parsed.skipped), 200);
  } catch {
    return json({ error: "Ingest failed" }, 500);
  }
}
