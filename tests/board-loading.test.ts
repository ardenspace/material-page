import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import Board from "../src/components/Board";

describe("페이지 진입 시 인증 확인 화면", () => {
  it.each(["inbox", "saved", "trashed", "team"] as const)("%s: 인증 확인 중 로그인 소개 대신 보드 로딩 화면을 표시한다", page => {
    // Every route mounts a new Board, before its auth effect has completed.
    const html = renderToStaticMarkup(createElement(Board, { page }));
    expect(html).not.toContain("좋은 이야기는");
    expect(html).not.toContain("auth-layout");
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("소재함을 불러오는 중");
    expect(html).not.toContain("휴지통이 비어 있어요");
  });
});
