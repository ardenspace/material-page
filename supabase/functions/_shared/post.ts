import type { ParsedCard } from "./parse.ts";

export type PostInfo = {
  post_text: string | null; author_name: string | null; author_handle: string | null;
  image_url: string | null; likes: number | null; replies: number | null; posted_at: string | null;
};
export type StoredItem = ParsedCard & PostInfo;
export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

const noInfo: PostInfo = { post_text: null, author_name: null, author_handle: null, image_url: null, likes: null, replies: null, posted_at: null };
const entities: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'" };

function decode(text: string): string {
  return text.replace(/&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/gi, (whole, dec, hex, name) => {
    if (name) return entities[name.toLowerCase()] ?? whole;
    const code = dec ? Number(dec) : parseInt(hex, 16);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
  });
}

const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const text = (value: unknown): string | null => typeof value === "string" && value.trim() ? value.trim() : null;
const count = (value: unknown): number | null => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
const pbs = (value: unknown): string | null => typeof value === "string" && value.startsWith("https://pbs.twimg.com/") ? value : null;
const handle = (value: unknown): string | null => typeof value === "string" && /^[A-Za-z0-9_]{1,15}$/.test(value) ? value : null;

function instant(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}

function displayText(post: Record<string, unknown>): string | null {
  const note = text(record(record(record(post.note_tweet)?.note_tweet_results)?.result)?.text);
  let body = note;
  if (body === null) {
    if (typeof post.text !== "string") return null;
    // X counts display_text_range in code points of the unescaped text.
    const points = [...decode(post.text)];
    const range = post.display_text_range;
    const valid = Array.isArray(range) && range.length === 2 && range.every(Number.isInteger) &&
      0 <= range[0] && range[0] <= range[1] && range[1] <= points.length;
    body = valid ? points.slice(range[0], range[1]).join("") : points.join("");
  } else body = decode(body);
  const media = record(post.entities)?.media;
  for (const item of Array.isArray(media) ? media : []) {
    const link = record(item)?.url;
    if (typeof link === "string" && link) body = body.split(link).join("");
  }
  return text(body);
}

export function fromSyndication(value: unknown): PostInfo | null {
  const post = record(value);
  const user = record(post?.user);
  if (!post || post.__typename !== "Tweet" || !user) return null;
  const media = Array.isArray(post.mediaDetails) ? record(post.mediaDetails[0]) : null;
  return {
    post_text: displayText(post), author_name: text(user.name), author_handle: text(user.screen_name),
    image_url: pbs(media?.media_url_https), likes: count(post.favorite_count), replies: count(post.conversation_count),
    posted_at: instant(post.created_at),
  };
}

export function fromOembed(value: unknown): PostInfo | null {
  const embed = record(value);
  const author = text(embed?.author_name);
  if (!embed || !author) return null;
  const paragraph = typeof embed.html === "string" ? embed.html.match(/<p\b[^>]*>([\s\S]*?)<\/p>/i)?.[1] : undefined;
  let body = paragraph === undefined ? null : decode(paragraph.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]*>/g, ""));
  if (body !== null) body = body.replace(/(?:\s*(?:https?:\/\/)?(?:pic\.twitter\.com|t\.co)\/\S*)+\s*$/i, "");
  let account: string | null = null;
  if (typeof embed.author_url === "string") {
    try { account = handle(new URL(embed.author_url).pathname.split("/").filter(Boolean).pop()); } catch { account = null; }
  }
  return { ...noInfo, post_text: body === null ? null : text(body), author_name: author, author_handle: account };
}

async function getJson(fetchImpl: Fetch, url: string, timeoutMs: number): Promise<unknown> {
  try {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (response.status !== 200) return null;
    return await response.json();
  } catch { return null; }
}

export async function lookupPost(card: ParsedCard, fetchImpl: Fetch, timeoutMs = 5000): Promise<StoredItem> {
  try {
    const found = fromSyndication(await getJson(fetchImpl, `https://cdn.syndication.twimg.com/tweet-result?id=${card.post_id}&token=a`, timeoutMs)) ??
      fromOembed(await getJson(fetchImpl, `https://publish.x.com/oembed?url=${encodeURIComponent(card.url)}`, timeoutMs));
    return { ...card, ...(found ?? noInfo) };
  } catch { return { ...card, ...noInfo }; }
}

export function lookupPosts(cards: ParsedCard[], fetchImpl: Fetch, timeoutMs = 5000): Promise<StoredItem[]> {
  return Promise.all(cards.map(card => lookupPost(card, fetchImpl, timeoutMs)));
}

export function linkOnly(cards: ParsedCard[]): StoredItem[] {
  return cards.map(card => ({ ...card, ...noInfo }));
}
