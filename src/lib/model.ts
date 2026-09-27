export type Status = "inbox" | "saved" | "trashed";
export type Material = {
  id: string; batch_id: string; kind: "parsed" | "raw"; status: Status; prev_status: "inbox" | "saved" | null;
  post_id: string | null; url: string | null; category: string | null; likes: number | null; retweets: number | null;
  summary: string | null; reason: string | null; raw_text: string | null; position: number;
  post_text: string | null; author_name: string | null; author_handle: string | null; image_url: string | null;
  replies: number | null; posted_at: string | null;
  saved_at: string | null; trashed_at: string | null;
};
export type Batch = { id: string; received_at: string };
export type Comment = { id: string; material_id: string; author_id: string; body: string; created_at: string; updated_at: string | null };
export type Rating = { material_id: string; author_id: string; score: number };
export type Profile = { id: string; display_name: string; avatar_url: string | null };
export type Allow = { email: string; role: "admin" | "member"; added_at: string };

export function kst(value: string): string {
  return new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", weekday: "short",
    hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(value));
}
export function batchTitle(value: string): string {
  const date = new Date(value);
  const parts = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", weekday: "short", hour: "numeric", minute: "numeric", hour12: true }).formatToParts(date);
  const get = (kind: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === kind)?.value ?? "";
  const minute = Number(get("minute"));
  return `${get("month")}/${get("day")} (${get("weekday")}) ${get("dayPeriod")} ${get("hour")}시${minute ? ` ${minute}분` : ""}`;
}
