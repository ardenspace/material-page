import { expect, it } from "vitest";
import { batchTitle } from "../src/lib/model";

it("회차 제목은 KST이고 정각에는 분을 생략한다", () => {
  expect(batchTitle("2026-09-26T11:00:00Z")).toBe("9/26 (토) 오후 8시");
  expect(batchTitle("2026-09-26T11:05:00Z")).toBe("9/26 (토) 오후 8시 5분");
});
