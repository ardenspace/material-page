export type Category = "밈" | "웃긴 게시물" | "화제" | "반응" | "기타";
export type ParsedCard = { kind: "parsed"; position: number; post_id: string; url: string; category: Category };

const linkPattern = /https?:\/\/(?:(?:www|mobile)\.)?(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})\/status\/(\d+)/gi;
const categories: Record<string, Category> = { "밈": "밈", "웃긴": "웃긴 게시물", "웃긴 게시물": "웃긴 게시물", "화제": "화제", "반응": "반응" };

function categoryOf(prefix: string): Category {
  const label = prefix.trim()
    .replace(/^(?:\d+[.)]|\(\d+\)|\[\d+\])\s*/, "")
    .replace(/^[-*•·]\s*/, "")
    .replace(/[:：]$/, "")
    .trim();
  return categories[label] ?? "기타";
}

type Found = { post_id: string; url: string; category: Category };

function findLinks(text: string): Found[] {
  const found: Found[] = [];
  for (const line of text.split("\n")) {
    let from = 0;
    for (const match of line.matchAll(linkPattern)) {
      const start = match.index ?? 0;
      found.push({ post_id: match[2], url: `https://x.com/${match[1]}/status/${match[2]}`, category: categoryOf(line.slice(from, start)) });
      // A link runs until whitespace (query, fragment, /photo/1), but never into the next link.
      const end = start + match[0].length;
      const space = line.slice(end).search(/\s/);
      from = space < 0 ? line.length : end + space;
    }
  }
  return found;
}

export function parseMail(body: string): { cards: ParsedCard[]; skipped: number } {
  let text = body.replace(/\r\n?/g, "\n");
  const cut = text.search(/continue reading/i);
  if (cut >= 0) text = text.slice(0, cut);
  const links = findLinks(text);
  // A truncated mail may cut the last link mid-number, so it is always dropped.
  if (cut >= 0) links.pop();
  const cards: ParsedCard[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  for (const link of links) {
    if (seen.has(link.post_id)) { skipped++; continue; }
    seen.add(link.post_id);
    cards.push({ kind: "parsed", position: cards.length, ...link });
  }
  return { cards, skipped };
}
