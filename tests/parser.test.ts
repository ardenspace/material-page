import { describe, expect, it } from "vitest";
import { parseMail } from "../supabase/functions/_shared/parse";

describe("Grok 메일 해석", () => {
  it("한 줄에 하나씩 분류와 링크를 읽는다", () => {
    const result = parseMail("밈 https://x.com/gangwon/status/123\n화제 https://x.com/b/status/456\n");
    expect(result).toEqual({ skipped: 0, cards: [
      { kind: "parsed", position: 0, post_id: "123", url: "https://x.com/gangwon/status/123", category: "밈" },
      { kind: "parsed", position: 1, post_id: "456", url: "https://x.com/b/status/456", category: "화제" },
    ] });
  });
  it.each(["https://twitter.com/a/status/1?x=2", "https://mobile.x.com/a/status/1/photo/1", "http://www.twitter.com/a/status/1/#photo", "https://x.com/a/status/1/"])("링크 변형 %s", link => {
    expect(parseMail(`반응 ${link}`).cards[0]).toMatchObject({ post_id: "1", url: "https://x.com/a/status/1", category: "반응" });
  });
  it("잘못된 주소는 링크로 보지 않는다", () => {
    expect(parseMail("밈 https://evil.example/a/status/1\n밈 https://x.com/a/photo/1\n밈 https://x.com/abcdefghijklmnop/status/1").cards).toEqual([]);
  });
  it("번호 전체를 취한다", () => {
    expect(parseMail("밈 https://x.com/a/status/1971234567890123456").cards[0].post_id).toBe("1971234567890123456");
  });
  it("한 줄의 여러 링크를 모두 찾고 분류는 앞 링크 뒤부터 읽는다", () => {
    const result = parseMail("밈 https://x.com/a/status/1?s=20 화제 https://x.com/b/status/2https://x.com/c/status/3");
    expect(result.cards.map(card => [card.post_id, card.category])).toEqual([["1", "밈"], ["2", "화제"], ["3", "기타"]]);
  });
  it.each([
    ["1. 밈", "밈"], ["1) 화제", "화제"], ["(2) 반응", "반응"], ["[3] 밈", "밈"], ["- 웃긴:", "웃긴 게시물"], ["* 밈", "밈"],
    ["• 반응：", "반응"], ["· 화제", "화제"], ["웃긴 게시물", "웃긴 게시물"], ["  밈  ", "밈"],
    ["재밌는 밈", "기타"], ["링크:", "기타"], ["", "기타"], ["밈밈", "기타"],
  ])("분류 %j → %s", (prefix, category) => {
    expect(parseMail(`${prefix} https://x.com/a/status/1`).cards[0].category).toBe(category);
  });
  it("잘린 메일은 문구 앞의 마지막 링크를 버리고 문구 뒤는 읽지 않는다", () => {
    const result = parseMail("밈 https://x.com/a/status/1\n화제 https://x.com/b/status/2\n반응 https://x.com/c/status/34… Continue reading\n밈 https://x.com/d/status/4");
    expect(result.cards.map(card => card.post_id)).toEqual(["1", "2"]);
    expect(result.skipped).toBe(0);
  });
  it("번호가 온전해 보여도 잘린 메일의 마지막 링크를 버린다", () => {
    expect(parseMail("밈 https://x.com/a/status/1\n화제 https://x.com/b/status/2\nCONTINUE READING").cards.map(card => card.post_id)).toEqual(["1"]);
  });
  it("링크가 하나뿐인 잘린 메일은 빈 결과다", () => {
    expect(parseMail("밈 https://x.com/a/status/123\ncontinue reading")).toEqual({ cards: [], skipped: 0 });
  });
  it("같은 게시물은 앞의 것만 남기고 뒤의 것은 건너뛴 수로 센다", () => {
    const result = parseMail("밈 https://twitter.com/a/status/123\n화제 https://x.com/b/status/5\n반응 https://x.com/a/status/123");
    expect(result.cards.map(card => [card.post_id, card.position])).toEqual([["123", 0], ["5", 1]]);
    expect(result.skipped).toBe(1);
  });
  it("링크가 없는 메일은 카드를 만들지 않는다", () => {
    expect(parseMail("제목\r\n오늘은 소재가 없어요")).toEqual({ cards: [], skipped: 0 });
  });
  it("요청문의 예시 줄은 링크로 인식하지 않는다", () => {
    expect(parseMail("예) 밈 https://x.com/아이디/status/게시물번호").cards).toEqual([]);
  });
  it("줄바꿈 형식을 통일한다", () => {
    expect(parseMail("밈 https://x.com/a/status/1\r화제 https://x.com/b/status/2\r\n").cards.map(card => card.category)).toEqual(["밈", "화제"]);
  });
});
