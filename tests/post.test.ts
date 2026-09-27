import { describe, expect, it, vi } from "vitest";
import type { ParsedCard } from "../supabase/functions/_shared/parse";
import { fromOembed, fromSyndication, lookupPost, lookupPosts, type Fetch } from "../supabase/functions/_shared/post";

const card: ParsedCard = { kind: "parsed", position: 0, post_id: "1971234567890123456", url: "https://x.com/abc/status/1971234567890123456", category: "밈" };
const noInfo = { post_text: null, author_name: null, author_handle: null, image_url: null, likes: null, replies: null, posted_at: null };
const tweet = {
  __typename: "Tweet", text: "강원도 감자 &amp; 옥수수 https://t.co/media1", display_text_range: [0, 13],
  user: { name: "강원 사람", screen_name: "abc" }, favorite_count: 1234, conversation_count: 5,
  created_at: "2026-09-27T01:23:45.000Z", entities: { media: [{ url: "https://t.co/media1" }] },
  mediaDetails: [{ type: "photo", media_url_https: "https://pbs.twimg.com/media/abc.jpg" }],
};
const embed = {
  author_name: "강원 사람", author_url: "https://twitter.com/abc",
  html: "<blockquote class=\"twitter-tweet\"><p lang=\"ko\" dir=\"ltr\">첫 줄<br>둘째 &quot;줄&quot; <a href=\"https://t.co/x\">#감자</a> <a href=\"https://t.co/p\">pic.twitter.com/AbC</a></p>&mdash; 강원 사람 (@abc) <a href=\"https://twitter.com/abc/status/1\">September 27, 2026</a></blockquote>",
};
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
function fake(syndication: () => Promise<Response>, oembed: () => Promise<Response>) {
  return vi.fn<Fetch>(async url => url.startsWith("https://cdn.syndication.twimg.com/") ? syndication() : oembed());
}

describe("syndication 응답 변환", () => {
  it("본문, 작성자, 사진, 수치, 시각을 채운다", () => {
    expect(fromSyndication(tweet)).toEqual({ post_text: "강원도 감자 & 옥수수", author_name: "강원 사람", author_handle: "abc",
      image_url: "https://pbs.twimg.com/media/abc.jpg", likes: 1234, replies: 5, posted_at: "2026-09-27T01:23:45.000Z" });
  });
  it("표시 범위를 코드 포인트 기준으로 자른다", () => {
    expect(fromSyndication({ ...tweet, text: "@a 😀감자 https://t.co/q", display_text_range: [3, 6], entities: {} })?.post_text).toBe("😀감자");
  });
  it("범위가 이상하면 본문 전체에서 사진 t.co 주소만 지운다", () => {
    expect(fromSyndication({ ...tweet, display_text_range: [5, 999] })?.post_text).toBe("강원도 감자 & 옥수수");
    expect(fromSyndication({ ...tweet, display_text_range: undefined })?.post_text).toBe("강원도 감자 & 옥수수");
  });
  it("긴 글 전문이 있으면 전문을 쓴다", () => {
    const long = { ...tweet, note_tweet: { note_tweet_results: { result: { text: "아주 긴 글 &lt;전문&gt; https://t.co/media1" } } } };
    expect(fromSyndication(long)?.post_text).toBe("아주 긴 글 <전문>");
  });
  it("pbs.twimg.com이 아닌 사진 주소와 잘못된 값은 비운다", () => {
    const odd = { ...tweet, mediaDetails: [{ media_url_https: "https://evil.example/a.jpg" }], favorite_count: -1, conversation_count: "5", created_at: "어제" };
    expect(fromSyndication(odd)).toMatchObject({ image_url: null, likes: null, replies: null, posted_at: null });
  });
  it("본문이 비면 null이다", () => {
    expect(fromSyndication({ ...tweet, text: "https://t.co/media1", display_text_range: [0, 19] })?.post_text).toBeNull();
  });
  it("tombstone이나 작성자가 없는 응답은 실패다", () => {
    expect(fromSyndication({ __typename: "TweetTombstone", tombstone: {} })).toBeNull();
    expect(fromSyndication({ ...tweet, user: undefined })).toBeNull();
    expect(fromSyndication(null)).toBeNull();
  });
});

describe("oEmbed 응답 변환", () => {
  it("첫 문단의 글자와 작성자를 채우고 나머지는 비운다", () => {
    expect(fromOembed(embed)).toEqual({ ...noInfo, post_text: "첫 줄\n둘째 \"줄\" #감자", author_name: "강원 사람", author_handle: "abc" });
  });
  it("계정 규칙에 맞지 않는 주소는 아이디를 비운다", () => {
    expect(fromOembed({ ...embed, author_url: "https://x.com/i/web" })?.author_handle).toBe("web");
    expect(fromOembed({ ...embed, author_url: "https://x.com/abcdefghijklmnop" })?.author_handle).toBeNull();
    expect(fromOembed({ ...embed, author_url: "잘못된 주소" })?.author_handle).toBeNull();
  });
  it("작성자가 없으면 실패다", () => {
    expect(fromOembed({ html: "<p>글</p>" })).toBeNull();
  });
});

describe("게시물 정보 조회", () => {
  it("syndication이 성공하면 oEmbed를 부르지 않는다", async () => {
    const fetch = fake(async () => json(tweet), async () => json(embed));
    const item = await lookupPost(card, fetch);
    expect(item).toMatchObject({ ...card, author_name: "강원 사람", likes: 1234 });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe("https://cdn.syndication.twimg.com/tweet-result?id=1971234567890123456&token=a");
  });
  it("syndication이 실패하면 oEmbed로 넘어간다", async () => {
    const fetch = fake(async () => json({ __typename: "TweetTombstone" }), async () => json(embed));
    expect(await lookupPost(card, fetch)).toEqual({ ...card, ...noInfo, post_text: "첫 줄\n둘째 \"줄\" #감자", author_name: "강원 사람", author_handle: "abc" });
    expect(fetch.mock.calls[1][0]).toBe(`https://publish.x.com/oembed?url=${encodeURIComponent(card.url)}`);
  });
  it.each([
    ["404", async () => json({}, 404)],
    ["빈 응답", async () => new Response("")],
    ["네트워크 오류", async () => { throw new TypeError("network"); }],
  ])("둘 다 %s이면 링크만 남긴다", async (_, failure) => {
    expect(await lookupPost(card, fake(failure, failure))).toEqual({ ...card, ...noInfo });
  });
  it("요청마다 제한 시간을 건다", async () => {
    const hang: Fetch = (_, init) => new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal?.reason)));
    const started = Date.now();
    expect(await lookupPost(card, vi.fn(hang), 20)).toEqual({ ...card, ...noInfo });
    expect(Date.now() - started).toBeLessThan(1000);
  });
  it("여러 카드를 동시에 조회하고 순서를 지킨다", async () => {
    let active = 0; let peak = 0;
    const fetch = vi.fn<Fetch>(async () => { active++; peak = Math.max(peak, active); await new Promise(r => setTimeout(r, 10)); active--; return json(tweet); });
    const items = await lookupPosts([card, { ...card, position: 1, post_id: "2" }, { ...card, position: 2, post_id: "3" }], fetch);
    expect(items.map(item => item.position)).toEqual([0, 1, 2]);
    expect(peak).toBe(3);
  });
});
