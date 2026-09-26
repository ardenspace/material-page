import { describe, expect, it, vi } from "vitest";
import { handleIngest } from "../supabase/functions/ingest/handler";

const body = "===강원소재===\n[1]\n링크: https://x.com/a/status/1\n===끝===";
const request = (token = "secret", value: unknown = { messageId: "m1", receivedAt: "2026-09-26T00:00:00Z", body }) =>
  new Request("http://localhost/ingest", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(value) });

describe("ingest 인증과 응답", () => {
  it("비밀값이 틀리면 DB를 호출하지 않는다", async () => {
    const save = vi.fn();
    expect((await handleIngest(request("wrong"), "secret", save)).status).toBe(401);
    expect(save).not.toHaveBeenCalled();
  });
  it("잘못된 본문을 거부한다", async () => {
    const save = vi.fn();
    expect((await handleIngest(request("secret", { messageId: "", receivedAt: "wrong", body: "" }), "secret", save)).status).toBe(400);
    expect(save).not.toHaveBeenCalled();
  });
  it("해석 결과를 한 번 저장하고 응답을 전달한다", async () => {
    const result = { status: "created" as const, batchId: "batch", parsed: 1, raw: 0, skipped: 0 };
    const save = vi.fn().mockResolvedValue(result);
    const response = await handleIngest(request(), "secret", save);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(result);
    expect(save.mock.calls[0][2]).toMatchObject([{ kind: "parsed", post_id: "1" }]);
  });
});
