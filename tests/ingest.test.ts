import { describe, expect, it, vi } from "vitest";
import { handleIngest } from "../supabase/functions/ingest/handler";
import { lookupPosts } from "../supabase/functions/_shared/post";

const body = "밈 https://x.com/a/status/1";
const request = (token = "secret", value: unknown = { messageId: "m1", receivedAt: "2026-09-26T00:00:00Z", body }) =>
  new Request("http://localhost/ingest", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(value) });
const created = { status: "created" as const, batchId: "batch", parsed: 1, raw: 0, skipped: 0 };
const noInfo = { post_text: null, author_name: null, author_handle: null, image_url: null, likes: null, replies: null, posted_at: null };

describe("ingest 인증과 응답", () => {
  it("비밀값이 틀리면 조회와 DB를 호출하지 않는다", async () => {
    const save = vi.fn();
    const lookup = vi.fn();
    expect((await handleIngest(request("wrong"), "secret", save, lookup)).status).toBe(401);
    expect(save).not.toHaveBeenCalled();
    expect(lookup).not.toHaveBeenCalled();
  });
  it("잘못된 본문을 거부한다", async () => {
    const save = vi.fn();
    expect((await handleIngest(request("secret", { messageId: "", receivedAt: "wrong", body: "" }), "secret", save, vi.fn())).status).toBe(400);
    expect(save).not.toHaveBeenCalled();
  });
  it("조회한 항목을 한 번 저장하고 응답을 전달한다", async () => {
    const save = vi.fn().mockResolvedValue(created);
    const lookup = vi.fn(async cards => cards.map((card: object) => ({ ...card, ...noInfo, author_name: "작성자" })));
    const response = await handleIngest(request(), "secret", save, lookup);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(created);
    expect(lookup.mock.calls[0][0]).toEqual([{ kind: "parsed", position: 0, post_id: "1", url: "https://x.com/a/status/1", category: "밈" }]);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][2]).toMatchObject([{ kind: "parsed", post_id: "1", author_name: "작성자" }]);
  });
  it("링크가 없는 메일도 빈 목록으로 저장 함수를 한 번 호출한다", async () => {
    const result = { ...created, parsed: 0 };
    const save = vi.fn().mockResolvedValue(result);
    const response = await handleIngest(request("secret", { messageId: "m2", receivedAt: "2026-09-26T00:00:00Z", body: "오늘은 없어요" }), "secret", save, cards => lookupPosts(cards, vi.fn()));
    expect(await response.json()).toEqual(result);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0].slice(2)).toEqual([[], 0]);
  });
  it("외부 조회가 모두 실패해도 링크만 있는 카드로 200을 돌려준다", async () => {
    const save = vi.fn().mockResolvedValue(created);
    const fail = vi.fn().mockRejectedValue(new TypeError("network"));
    const response = await handleIngest(request(), "secret", save, cards => lookupPosts(cards, fail));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(created);
    expect(save.mock.calls[0][2]).toEqual([{ kind: "parsed", position: 0, post_id: "1", url: "https://x.com/a/status/1", category: "밈", ...noInfo }]);
  });
  it("조회 함수가 예외를 던져도 링크만 있는 카드로 저장한다", async () => {
    const save = vi.fn().mockResolvedValue(created);
    const response = await handleIngest(request(), "secret", save, vi.fn().mockRejectedValue(new Error("boom")));
    expect(response.status).toBe(200);
    expect(save.mock.calls[0][2]).toMatchObject([{ post_id: "1", ...noInfo }]);
  });
  it("저장이 실패하면 500이다", async () => {
    const response = await handleIngest(request(), "secret", vi.fn().mockRejectedValue(new Error("db")), async () => []);
    expect(response.status).toBe(500);
  });
});
