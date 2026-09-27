"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Feedback from "@/components/Feedback";
import { batchTitle, kst, type Allow, type Batch, type Comment, type Material, type Profile, type Rating, type Status } from "@/lib/model";
import { supabase } from "@/lib/supabase";

type Page = "inbox" | "saved" | "trashed" | "team";
type BoardData = { materials: Material[]; batches: Batch[]; comments: Comment[]; ratings: Rating[]; profiles: Profile[]; allowlist: Allow[]; retentionDays: number };
const empty: BoardData = { materials: [], batches: [], comments: [], ratings: [], profiles: [], allowlist: [], retentionDays: 30 };
const labels: Record<Page, string> = { inbox: "소재 모음", saved: "저장됨", trashed: "휴지통", team: "팀원 관리" };
const paths: Record<Page, string> = { inbox: "/", saved: "/saved/", trashed: "/trash/", team: "/team/" };
const statusOf: Record<Exclude<Page, "team">, Status> = { inbox: "inbox", saved: "saved", trashed: "trashed" };
const categories = ["전체", "밈", "웃긴 게시물", "화제", "반응", "기타", "양식 오류"];

async function allRows<T>(table: string, status?: Status): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += 1000) {
    let query = supabase().from(table).select("*").range(from, from + 999);
    if (status) query = query.eq("status", status);
    query = table === "ratings" ? query.order("material_id").order("author_id") :
      table === "allowlist" ? query.order("email") : query.order("id");
    const { data, error } = await query;
    if (error) throw error;
    rows.push(...(data as T[]));
    if (!data || data.length < 1000) break;
  }
  return rows;
}

async function clientRevision(): Promise<number> {
  const { data, error } = await supabase().from("board_revision").select("retention_days").eq("id", 1).single();
  if (error) throw error;
  return Number(data.retention_days);
}

export default function Board({ page }: { page: Page }) {
  const [userId, setUserId] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [mode, setMode] = useState<"loading" | "login" | "denied" | "ready" | "error">("loading");
  const [admin, setAdmin] = useState(false);
  const [data, setData] = useState<BoardData>(empty);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("전체");
  const [sort, setSort] = useState<"saved" | "rating">("saved");
  const [notice, setNotice] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [now, setNow] = useState(0);
  const generation = useRef(0);
  const busy = useRef(false);
  const queued = useRef(false);

  const deny = useCallback(() => {
    generation.current++;
    setData(empty); setUserId(null); setMode("denied");
    void supabase().removeAllChannels();
  }, []);

  const check = useCallback(async () => {
    const client = supabase();
    const { data: auth, error: authError } = await client.auth.getUser();
    if (authError || !auth.user) { generation.current++; setData(empty); setMode("login"); return false; }
    const { data: member, error } = await client.rpc("is_member");
    if (error) { setMode("error"); return false; }
    if (!member) { deny(); return false; }
    setUserId(auth.user.id); setEmail(auth.user.email ?? "");
    const { data: isAdmin, error: adminError } = await client.rpc("is_admin");
    if (adminError) { setMode("error"); return false; }
    setAdmin(Boolean(isAdmin));
    if (page === "team" && !isAdmin) { setMode("denied"); setData(empty); return false; }
    setMode("ready");
    return true;
  }, [deny, page]);

  const reload = useCallback(async () => {
    if (busy.current) { queued.current = true; return; }
    busy.current = true;
    try {
      do {
        queued.current = false;
        const token = ++generation.current;
        if (!(await check())) break;
        const status = page === "team" ? undefined : statusOf[page];
        const [materials, batches, comments, ratings, profiles, allowlist, revision] = await Promise.all([
          allRows<Material>("materials", status), allRows<Batch>("batches"), allRows<Comment>("comments"),
          allRows<Rating>("ratings"), allRows<Profile>("profiles"), page === "team" ? allRows<Allow>("allowlist") : Promise.resolve([]),
          clientRevision(),
        ]);
        if (token === generation.current) setData({ materials, batches, comments, ratings, profiles, allowlist, retentionDays: revision });
      } while (queued.current);
    } catch {
      setNotice("데이터를 불러오지 못했어요. 연결을 확인해 주세요.");
    } finally { busy.current = false; }
  }, [check, page]);

  useEffect(() => {
    let disposed = false;
    const client = supabase();
    const channel = client.channel(`board-${page}`).on("postgres_changes", { event: "UPDATE", schema: "public", table: "board_revision" }, () => { void reload(); });
    channel.subscribe(status => { if (!disposed && status === "SUBSCRIBED") void reload(); });
    const { data: listener } = client.auth.onAuthStateChange(() => { if (!disposed) setTimeout(() => { void reload(); }, 0); });
    const timer = setInterval(() => { if (!document.hidden) void check(); setNow(Date.now()); }, 30_000);
    const clockStart = setTimeout(() => setNow(Date.now()), 0);
    const visible = () => { if (!document.hidden) void reload(); };
    document.addEventListener("visibilitychange", visible);
    const online = () => { void reload(); };
    window.addEventListener("online", online);
    return () => { disposed = true; clearInterval(timer); clearTimeout(clockStart); document.removeEventListener("visibilitychange", visible);
      window.removeEventListener("online", online); listener.subscription.unsubscribe(); void client.removeChannel(channel); };
  }, [check, page, reload]);

  const profiles = useMemo(() => new Map(data.profiles.map(profile => [profile.id, profile])), [data.profiles]);
  const ratingsByMaterial = useMemo(() => {
    const map = new Map<string, Rating[]>();
    for (const rating of data.ratings) map.set(rating.material_id, [...(map.get(rating.material_id) ?? []), rating]);
    return map;
  }, [data.ratings]);
  const commentsByMaterial = useMemo(() => {
    const map = new Map<string, Comment[]>();
    for (const comment of data.comments) map.set(comment.material_id, [...(map.get(comment.material_id) ?? []), comment]);
    for (const comments of map.values()) comments.sort((a, b) => a.created_at.localeCompare(b.created_at));
    return map;
  }, [data.comments]);
  const displayed = useMemo(() => {
    let rows = data.materials;
    const batches = new Map(data.batches.map(batch => [batch.id, batch.received_at]));
    if (page !== "trashed" && page !== "team") {
      if (category !== "전체") rows = rows.filter(material => category === "양식 오류" ? material.kind === "raw" : material.category === category);
      const term = query.trim().toLocaleLowerCase();
      if (term) rows = rows.filter(material => [material.post_text, material.author_name, material.author_handle,
        material.summary, material.reason, material.raw_text, ...(commentsByMaterial.get(material.id) ?? []).map(comment => comment.body)].some(value => value?.toLocaleLowerCase().includes(term)));
    }
    const average = (id: string) => { const ratings = ratingsByMaterial.get(id) ?? []; return ratings.length ? ratings.reduce((sum, r) => sum + r.score, 0) / ratings.length : -1; };
    return [...rows].sort((a, b) => {
      if (page === "saved") return (sort === "rating" ? average(b.id) - average(a.id) : 0) ||
        (b.saved_at ?? "").localeCompare(a.saved_at ?? "") || a.id.localeCompare(b.id);
      if (page === "trashed") return (b.trashed_at ?? "").localeCompare(a.trashed_at ?? "") || a.id.localeCompare(b.id);
      return (batches.get(b.batch_id) ?? "").localeCompare(batches.get(a.batch_id) ?? "") || a.position - b.position || a.id.localeCompare(b.id);
    });
  }, [data.materials, data.batches, page, category, query, commentsByMaterial, ratingsByMaterial, sort]);

  const change = async (material: Material, action: "save" | "unsave" | "trash" | "restore") => {
    if (action === "trash" && !window.confirm("휴지통으로 옮길까요?")) return;
    const { data: applied, error } = await supabase().rpc("change_material", { p_id: material.id, p_expected_status: material.status, p_action: action });
    if (error) setNotice("변경하지 못했어요. 권한과 연결을 확인해 주세요.");
    else if (!applied) setNotice("다른 팀원이 이미 처리했어요.");
    void reload();
  };
  const logout = async () => { await supabase().auth.signOut(); generation.current++; setData(empty); setMode("login"); };
  const login = async () => {
    const { error } = await supabase().auth.signInWithOAuth({ provider: "google", options: { redirectTo: window.location.origin + paths[page] } });
    if (error) setNotice("로그인을 시작하지 못했어요.");
  };
  const manage = async (action: "add" | "remove", target: string) => {
    if (action === "remove" && !window.confirm(`${target} 팀원을 제거할까요?`)) return;
    const normalized = target.trim().toLowerCase();
    const request = action === "add" ? supabase().from("allowlist").insert({ email: normalized, role: "member" }) : supabase().from("allowlist").delete().eq("email", normalized);
    const { error } = await request;
    if (error) setNotice(action === "add" ? "팀원을 추가하지 못했어요. 이메일과 중복 여부를 확인해 주세요." : "팀원을 제거하지 못했어요.");
    else { setNewEmail(""); void reload(); }
  };

  if (mode === "loading") return <main className="center"><p>소재함을 여는 중…</p></main>;
  if (mode === "login") return <main className="center"><div className="auth-card"><h1>소재함</h1><p>팀의 다음 이야기를 함께 고르는 곳</p><button className="primary" onClick={login}>Google로 로그인</button>{notice && <p role="alert">{notice}</p>}</div></main>;
  if (mode === "denied") return <main className="center"><div className="auth-card"><h1>소재함</h1><p>등록되지 않은 계정입니다</p><button onClick={logout}>로그아웃</button></div></main>;
  if (mode === "error") return <main className="center"><div className="auth-card"><h1>연결을 확인해 주세요</h1><button onClick={() => void reload()}>다시 시도</button></div></main>;
  const batchMap = new Map(data.batches.map(batch => [batch.id, batch]));
  const groups = page === "inbox" ? [...new Set(displayed.map(material => material.batch_id))] : [];
  const legacyBody = (material: Material) => <>
    <div className="card-top"><span className="tag">{material.kind === "raw" ? "양식 오류" : material.category}</span>{material.url && <a href={material.url} target="_blank" rel="noopener noreferrer">원본 보기 ↗</a>}</div>
    {material.kind === "raw" ? <pre className="raw">{material.raw_text}</pre> : <><h3>{material.summary || "요약 없음"}</h3>{material.reason && <p className="reason">{material.reason}</p>}
      {(material.likes !== null || material.retweets !== null) && <p className="metrics">{material.likes !== null && `좋아요 ${material.likes.toLocaleString()}`} {material.retweets !== null && `리트윗 ${material.retweets.toLocaleString()}`}</p>}</>}
  </>;
  const postBody = (material: Material) => {
    const origin = <a className="origin" href={material.url!} target="_blank" rel="noopener noreferrer">원본 보기 ↗</a>;
    if (material.post_text === null && material.author_name === null) return <>
      <div className="card-top"><span className="tag">{material.category}</span></div>
      <p className="lookup-failed">게시물 정보를 불러오지 못했어요. 원본에서 확인해 주세요.</p>{origin}
    </>;
    const who = [material.author_name, material.author_handle && `@${material.author_handle}`].filter(Boolean).join(" ");
    const byline = [who, material.posted_at && kst(material.posted_at)].filter(Boolean).join(" · ");
    const metrics = [material.likes !== null && `좋아요 ${material.likes.toLocaleString("ko-KR")}`,
      material.replies !== null && `댓글 ${material.replies.toLocaleString("ko-KR")}`].filter(Boolean).join(" · ");
    return <>
      <div className="card-top"><span className="tag">{material.category}</span></div>
      {byline && <p className="byline">{byline}</p>}
      {material.post_text && <p className="post-text">{material.post_text}</p>}
      {/* eslint-disable-next-line @next/next/no-img-element -- static export serves X image URLs as-is */}
      {material.image_url && <img className="post-image" src={material.image_url} alt="게시물 첫 사진" loading="lazy" onError={event => { event.currentTarget.style.display = "none"; }}/>}
      {metrics && <p className="metrics">{metrics}</p>}
      {origin}
    </>;
  };
  // Legacy parser always filled summary (even ""), so null summary marks a card from the link-only format.
  const card = (material: Material) => <article key={material.id} className="card">
    {material.kind === "raw" || material.summary !== null ? legacyBody(material) : postBody(material)}
    {page === "trashed" && <p className="trash-info">{material.prev_status === "saved" ? "저장됨에서 삭제됨" : "소재 모음에서 삭제됨"} · 자동 삭제까지 {Math.max(0, Math.ceil((new Date(material.trashed_at!).getTime() + data.retentionDays * 86400000 - now) / 86400000))}일</p>}
    <div className="card-actions">{page === "inbox" && <button className="primary" onClick={() => void change(material, "save")}>저장</button>}
      {page === "saved" && <button onClick={() => void change(material, "unsave")}>저장 취소</button>}
      {page === "trashed" ? <button className="primary" onClick={() => void change(material, "restore")}>복구</button> : <button onClick={() => void change(material, "trash")}>삭제</button>}</div>
    {userId && <Feedback id={material.id} userId={userId} comments={commentsByMaterial.get(material.id) ?? []} ratings={ratingsByMaterial.get(material.id) ?? []} profiles={profiles} readonly={page === "trashed"} onChanged={() => void reload()} onError={setNotice}/>}
  </article>;
  return <div className="site"><header className="site-header"><div className="header-inner"><Link className="brand" href="/">소재함<span>✳</span></Link><nav aria-label="페이지 이동">{(["inbox", "saved", "trashed", ...(admin ? ["team"] : [])] as Page[]).map(item => <Link key={item} href={paths[item]} aria-current={page === item ? "page" : undefined}>{labels[item]}</Link>)}</nav><div className="account"><span>{email}</span><button onClick={logout}>로그아웃</button></div></div></header>
    <main className="content"><div className="page-head"><div><p className="eyebrow">GANGWON IDEA BOARD</p><h1>{labels[page]}</h1></div>{page !== "team" && <span className="count">{displayed.length}개 소재</span>}</div>
      {notice && <div role="alert" className="notice">{notice}<button onClick={() => setNotice("")}>닫기</button></div>}
      {page === "team" ? <><form className="team-form" onSubmit={event => { event.preventDefault(); void manage("add", newEmail); }}><label htmlFor="team-email">팀원 이메일</label><div><input id="team-email" type="email" required value={newEmail} onChange={event => setNewEmail(event.target.value)} placeholder="name@example.com"/><button className="primary">추가</button></div></form><div className="team-list">{data.allowlist.map(row => <div key={row.email}><div><strong>{row.email}</strong><small>{row.role === "admin" ? "관리자" : "팀원"} · {kst(row.added_at)} 추가</small></div>{row.role === "member" && <button onClick={() => void manage("remove", row.email)}>제거</button>}</div>)}</div></> : <>
        {page !== "trashed" && <div className="filters"><label>검색<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="본문, 작성자, 요약, 댓글 검색" /></label><label>분류<select value={category} onChange={event => setCategory(event.target.value)}>{categories.map(value => <option key={value}>{value}</option>)}</select></label>{page === "saved" && <label>정렬<select value={sort} onChange={event => setSort(event.target.value as "saved" | "rating")}><option value="saved">최근 저장순</option><option value="rating">별점 높은 순</option></select></label>}</div>}
        {displayed.length === 0 ? <p className="empty">표시할 소재가 없어요.</p> : page === "inbox" ? groups.map(id => <section key={id} className="batch"><h2>{batchMap.get(id) ? batchTitle(batchMap.get(id)!.received_at) : "회차"}</h2><div className="grid">{displayed.filter(material => material.batch_id === id).map(card)}</div></section>) : <div className="grid">{displayed.map(card)}</div>}
      </>}
    </main></div>;
}
