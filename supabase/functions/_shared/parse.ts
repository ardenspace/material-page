export type ParsedCard = {
  kind: "parsed";
  position: number;
  post_id: string;
  url: string;
  category: "밈" | "웃긴 게시물" | "화제" | "반응" | "기타";
  likes: number | null;
  retweets: number | null;
  summary: string;
  reason: string;
};
export type RawCard = { kind: "raw"; position: number; raw_text: string };
export type Card = ParsedCard | RawCard;

const fields: Record<string, keyof Pick<ParsedCard, "summary" | "reason"> | "link" | "category" | "likes" | "retweets"> = {
  "링크": "link", "분류": "category", "좋아요": "likes", "리트윗": "retweets",
  "요약": "summary", "재밌는 이유": "reason",
};

function parseLink(value: string): { post_id: string; url: string } | null {
  try {
    const link = new URL(value.trim());
    if (link.protocol !== "https:" && link.protocol !== "http:") return null;
    if (!/^(?:(?:www|mobile)\.)?(?:x|twitter)\.com$/i.test(link.hostname)) return null;
    const pieces = link.pathname.split("/").filter(Boolean);
    if (pieces.length < 3 || !/^[A-Za-z0-9_]{1,15}$/.test(pieces[0]) || pieces[1] !== "status" || !/^\d+$/.test(pieces[2])) return null;
    return { post_id: pieces[2], url: `https://x.com/${pieces[0]}/status/${pieces[2]}` };
  } catch { return null; }
}

function count(value: string | undefined): number | null {
  if (value === undefined) return null;
  const digits = value.replace(/[,\s]/g, "");
  if (!/^\d+$/.test(digits)) return null;
  const num = Number(digits);
  return Number.isSafeInteger(num) ? num : null;
}

export function parseMail(body: string): { cards: Card[]; skipped: number } {
  const lines = body.replace(/\r\n?/g, "\n").split("\n");
  const cards: Card[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  let position = 0;
  const pushRaw = (raw_text: string) => cards.push({ kind: "raw", position: position++, raw_text });
  const pushItem = (itemLines: string[]) => {
    const values: Record<string, string> = {};
    let active: string | null = null;
    for (const line of itemLines.slice(1)) {
      const match = line.trim().match(/^(링크|분류|좋아요|리트윗|요약|재밌는 이유)\s*[:：]\s*(.*)$/);
      if (match) {
        active = fields[match[1]];
        values[active] = match[2];
      } else if (active) {
        values[active] = `${values[active]}\n${line}`;
      }
    }
    for (const key of Object.keys(values)) values[key] = values[key].trim();
    const link = values.link ? parseLink(values.link) : null;
    if (!link) { pushRaw(itemLines.join("\n")); return; }
    if (seen.has(link.post_id)) { skipped++; return; }
    seen.add(link.post_id);
    const category = ["밈", "웃긴 게시물", "화제", "반응"].includes(values.category) ? values.category as ParsedCard["category"] : "기타";
    cards.push({ kind: "parsed", position: position++, ...link, category,
      likes: count(values.likes), retweets: count(values.retweets), summary: values.summary ?? "", reason: values.reason ?? "" });
  };
  const starts = lines.some(line => line.trim() === "===강원소재===");
  if (!starts) { pushRaw(body); return { cards, skipped }; }
  let index = 0;
  while (index < lines.length) {
    if (lines[index].trim() !== "===강원소재===") { index++; continue; }
    const blockStart = index++;
    const itemGroups: string[][] = [];
    let current: string[] | null = null;
    while (index < lines.length && lines[index].trim() !== "===끝===" && lines[index].trim() !== "===강원소재===") {
      const line = lines[index++];
      if (/^\s*\[\d+\]/.test(line)) {
        current = [line]; itemGroups.push(current);
      } else if (current) current.push(line);
    }
    if (itemGroups.length === 0) pushRaw(lines.slice(blockStart, index < lines.length && lines[index].trim() === "===끝===" ? index + 1 : index).join("\n"));
    else for (const group of itemGroups) pushItem(group);
    if (lines[index]?.trim() === "===끝===") index++;
  }
  return { cards, skipped };
}
