import { describe, expect, it } from "vitest";
import { parseMail } from "../supabase/functions/_shared/parse";

const header = "===강원소재===\n";
const footer = "\n===끝===";
const item = (link = "https://x.com/gangwon/status/123") => `[1]\n링크: ${link}\n분류: 밈\n좋아요: 1,234\n리트윗: 2 3\n요약: 강원도 이야기\n재밌는 이유: 공감`;

describe("Grok 메일 해석", () => {
  it("정상 항목과 링크, 반응 수를 정규화한다", () => {
    const result = parseMail(header + item() + footer);
    expect(result.cards[0]).toMatchObject({ kind: "parsed", post_id: "123", url: "https://x.com/gangwon/status/123", category: "밈", likes: 1234, retweets: 23, summary: "강원도 이야기" });
  });
  it("여러 블록을 순서대로 읽고 블록 밖 텍스트를 무시한다", () => {
    const result = parseMail(`소개\n${header}${item()}${footer}\n안내\n${header}${item("https://x.com/other/status/456")}${footer}`);
    expect(result.cards.map(card => card.position)).toEqual([0, 1]);
    expect(result.cards).toHaveLength(2);
  });
  it("여러 줄 요약과 전각 콜론을 읽는다", () => {
    const result = parseMail(`${header}[1]\n링크： https://x.com/a/status/1\n요약： 첫 줄\n둘째 줄\n재밌는 이유： 이유${footer}`);
    expect(result.cards[0]).toMatchObject({ kind: "parsed", summary: "첫 줄\n둘째 줄", reason: "이유" });
  });
  it.each(["https://twitter.com/a/status/1?x=2", "https://mobile.x.com/a/status/1/photo/1", "http://www.twitter.com/a/status/1/#photo"])("링크 변형 %s", link => {
    expect(parseMail(header + item(link) + footer).cards[0]).toMatchObject({ kind: "parsed", post_id: "1", url: "https://x.com/a/status/1" });
  });
  it("링크가 없거나 잘못되면 항목 원문을 남긴다", () => {
    expect(parseMail(`${header}[1]\n요약: 링크 없음${footer}`).cards[0]).toMatchObject({ kind: "raw", raw_text: "[1]\n요약: 링크 없음" });
    expect(parseMail(header + item("https://evil.example/a/status/1") + footer).cards[0].kind).toBe("raw");
  });
  it("분류와 숫자가 잘못되어도 카드를 만든다", () => {
    expect(parseMail(`${header}[1]\n링크: https://x.com/a/status/1\n분류: 불명\n좋아요: 많음\n리트윗: 9999999999999999999999${footer}`).cards[0])
      .toMatchObject({ kind: "parsed", category: "기타", likes: null, retweets: null, summary: "", reason: "" });
  });
  it("시작 표시가 없으면 본문 전체를 원문 카드로 남긴다", () => {
    expect(parseMail("제목\n내용").cards).toEqual([{ kind: "raw", position: 0, raw_text: "제목\n내용" }]);
  });
  it("끝 표시가 없거나 항목이 없는 블록도 보존한다", () => {
    expect(parseMail(header + item()).cards[0].kind).toBe("parsed");
    expect(parseMail(`${header}텍스트${footer}`).cards[0]).toMatchObject({ kind: "raw" });
  });
  it("한 메일의 중복 게시물은 앞 항목만 남긴다", () => {
    const result = parseMail(`${header}${item()}\n${item("https://twitter.com/b/status/123")}${footer}`);
    expect(result.cards).toHaveLength(1);
    expect(result.skipped).toBe(1);
  });
  it("서로 다른 원문 카드는 중복 제거하지 않는다", () => {
    const result = parseMail(`${header}[1]\n없음\n[2]\n없음${footer}`);
    expect(result.cards).toHaveLength(2);
    expect(result.cards.every(card => card.kind === "raw")).toBe(true);
  });
});
