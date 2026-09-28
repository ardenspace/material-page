import type { CSSProperties } from "react";

export type IconName = "inbox" | "saved" | "trashed" | "team" | "search" | "arrow" | "star" | "comment" | "logout" | "restore" | "close";
const paths: Record<IconName, string> = {
  inbox: "M4 4h16v16H4z M4 13h5l2 3h2l2-3h5",
  saved: "M6 3h12v18l-6-4-6 4z",
  trashed: "M3 6h18 M9 6V3h6v3 M5 6l1 15h12l1-15 M10 10v7 M14 10v7",
  team: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M16 4a4 4 0 0 1 0 8 M22 21v-2a4 4 0 0 0-3-3.87 M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
  search: "M21 21l-5-5 M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0",
  arrow: "M7 17 17 7 M7 7h10v10",
  star: "m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9z",
  comment: "M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-2 2V11.5a9.5 9.5 0 0 1 19 0Z",
  logout: "M9 21H4V3h5 M10 12h11 M17 8l4 4-4 4",
  restore: "M3 10a9 9 0 1 1 2 8 M3 4v6h6",
  close: "m6 6 12 12 M6 18 18 6",
};
export default function Icon({ name, style }: { name: IconName; style?: CSSProperties }) {
  return <svg className="icon" style={style} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}

export function BrandMark() {
  return <span className="brand-mark" aria-hidden="true"><svg width="23" height="23" viewBox="0 0 24 24" fill="none"><path d="M4 5h6l2 3h8v12H4V5Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/><path d="M8 12h8M8 16h5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/></svg></span>;
}
