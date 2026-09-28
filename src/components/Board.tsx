"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Feedback from "@/components/Feedback";
import Icon, { BrandMark } from "@/components/Icon";
import { batchTitle, kst, type Allow, type Batch, type Comment, type Material, type Profile, type Rating, type Status } from "@/lib/model";
import { supabase } from "@/lib/supabase";

type Page = "inbox" | "saved" | "trashed" | "team";
type BoardData = { materials: Material[]; batches: Batch[]; comments: Comment[]; ratings: Rating[]; profiles: Profile[]; allowlist: Allow[]; retentionDays: number };
const empty: BoardData = { materials: [], batches: [], comments: [], ratings: [], profiles: [], allowlist: [], retentionDays: 30 };
const labels: Record<Page, string> = { inbox: "소재 모음", saved: "저장됨", trashed: "휴지통", team: "팀원 관리" };
const descriptions: Record<Page, string> = {
  inbox: "발견한 이야기에서, 우리의 다음 콘텐츠를 골라보세요.",
  saved: "다음 콘텐츠가 될 좋은 아이디어를 모아두었어요.",
  trashed: "잠시 내려놓은 소재들. 필요하면 다시 꺼내보세요.",
  team: "좋은 이야기를 함께 발견하는 사람들을 관리하세요.",
};
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

  if (mode !== "ready") return <main className="auth-layout">
    <section className="auth-story">
      <Link className="brand" href="/"><BrandMark />소재함<span className="brand-dot">.</span></Link>
      <div className="auth-story-copy"><p className="eyebrow">A PLACE FOR YOUR NEXT IDEA</p><h2>좋은 이야기는<br />작은 발견에서.</h2><p>강원도의 새로운 이야기, 재미있는 순간들.<br />함께 모으고, 나누고, 다음 콘텐츠로 만들어가요.</p>
        <div className="idea-illustration" aria-hidden="true"><div className="idea-paper paper-back"><span>발견하고</span><i /><i /></div><div className="idea-paper paper-front"><span>함께 고르고</span><i /><i /><b>✳</b></div><div className="idea-folder"><BrandMark /><span>우리의 다음 이야기</span></div></div>
      </div><span className="auth-caption">GANGWON · CONTENTS WORKSPACE</span>
    </section>
    <section className="auth-panel"><div className="auth-card"><BrandMark />
      {mode === "loading" ? <><h1>반가워요.</h1><p role="status"><span className="loading-dot" />소재함을 여는 중이에요.</p></> : mode === "login" ? <><p className="eyebrow">WELCOME TO 소재함</p><h1>다음 이야기를<br />함께 시작해요.</h1><p>팀 계정으로 로그인하고<br />새로운 콘텐츠 소재를 만나보세요.</p><button className="google-login" onClick={login}><span className="google-symbol" aria-hidden="true">G</span>Google로 계속하기<span aria-hidden="true">→</span></button><small>초대받은 팀원만 이용할 수 있는 공간이에요.</small></> : mode === "denied" ? <><h1>초대가 필요해요.</h1><p>이 계정은 소재함에 등록되어 있지 않아요.<br />팀 관리자에게 초대를 요청해 주세요.</p><button onClick={logout}>다른 계정으로 로그인</button></> : <><h1>잠시 연결이 끊겼어요.</h1><p>연결 상태를 확인한 뒤 다시 시도해 주세요.</p><button className="primary" onClick={() => void reload()}>다시 시도</button></>}
      {notice && <p className="auth-notice" role="alert">{notice}</p>}
    </div><span className="auth-panel-footer">작은 아이디어가 모여, 더 좋은 콘텐츠로.</span></section>
  </main>;
  const batchMap = new Map(data.batches.map(batch => [batch.id, batch]));
  const groups = page === "inbox" ? [...new Set(displayed.map(material => material.batch_id))] : [];
  const legacyBody = (material: Material) => <>
    <div className="card-top"><span className="tag" data-category={material.category}>{material.kind === "raw" ? "양식 오류" : material.category}</span>{material.url && <a href={material.url} target="_blank" rel="noopener noreferrer">원본 보기 ↗</a>}</div>
    {material.kind === "raw" ? <pre className="raw">{material.raw_text}</pre> : <><h3>{material.summary || "요약 없음"}</h3>{material.reason && <p className="reason">{material.reason}</p>}
      {(material.likes !== null || material.retweets !== null) && <p className="metrics">{material.likes !== null && `좋아요 ${material.likes.toLocaleString()}`} {material.retweets !== null && `리트윗 ${material.retweets.toLocaleString()}`}</p>}</>}
  </>;
  const postBody = (material: Material) => {
    const origin = <a className="origin" href={material.url!} target="_blank" rel="noopener noreferrer">원본 보기 ↗</a>;
    if (material.post_text === null && material.author_name === null) return <>
      <div className="card-top"><span className="tag" data-category={material.category}>{material.category}</span></div>
      <p className="lookup-failed">게시물 정보를 불러오지 못했어요. 원본에서 확인해 주세요.</p>{origin}
    </>;
    const who = [material.author_name, material.author_handle && `@${material.author_handle}`].filter(Boolean).join(" ");
    const byline = [who, material.posted_at && kst(material.posted_at)].filter(Boolean).join(" · ");
    const metrics = [material.likes !== null && `좋아요 ${material.likes.toLocaleString("ko-KR")}`,
      material.replies !== null && `댓글 ${material.replies.toLocaleString("ko-KR")}`].filter(Boolean).join(" · ");
    return <>
      <div className="card-top"><span className="tag" data-category={material.category}>{material.category}</span></div>
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
    <div className="card-actions">{page === "inbox" && <button className="primary" onClick={() => void change(material, "save")}><Icon name="saved" />소재 저장</button>}
      {page === "saved" && <button onClick={() => void change(material, "unsave")}><Icon name="saved" />저장 취소</button>}
      {page === "trashed" ? <button className="primary" onClick={() => void change(material, "restore")}><Icon name="restore" />복구</button> : <button className="quiet-button" onClick={() => void change(material, "trash")}><Icon name="trashed" />삭제</button>}</div>
    {userId && <Feedback id={material.id} userId={userId} comments={commentsByMaterial.get(material.id) ?? []} ratings={ratingsByMaterial.get(material.id) ?? []} profiles={profiles} readonly={page === "trashed"} onChanged={() => void reload()} onError={setNotice}/>}
  </article>;
  return <div className="site">
    <a className="skip-link" href="#main-content">본문으로 바로가기</a>
    <header className="site-header"><div className="header-inner">
      <Link className="brand" href="/"><BrandMark />소재함<span className="brand-dot">.</span></Link>
      <div className="workspace-label"><span className="workspace-dot" />강원 콘텐츠 워크스페이스</div>
      <p className="nav-label">WORKSPACE</p>
      <nav aria-label="페이지 이동">{(["inbox", "saved", "trashed", ...(admin ? ["team"] : [])] as Page[]).map(item => <Link key={item} href={paths[item]} aria-current={page === item ? "page" : undefined}><Icon name={item} />{labels[item]}{page === item && item !== "team" && <span className="nav-count">{data.materials.length}</span>}</Link>)}</nav>
      <div className="sidebar-note"><span aria-hidden="true">✳</span><strong>작은 발견, 좋은 콘텐츠.</strong><p>눈길이 가는 소재를 저장하고<br />팀의 생각을 더해보세요.</p></div>
      <div className="account"><span className="avatar">{(profiles.get(userId ?? "")?.display_name || email || "팀").slice(0, 1).toUpperCase()}</span><div><strong>{profiles.get(userId ?? "")?.display_name || "팀 워크스페이스"}</strong><span title={email}>{email}</span></div><button className="icon-button" onClick={logout} aria-label="로그아웃" title="로그아웃"><Icon name="logout" /></button></div>
    </div></header>
    <div className="main-area"><div className="topbar"><span>워크스페이스 <span className="breadcrumb-divider">/</span> <strong>{labels[page]}</strong></span><span className="topbar-caption">함께 발견하는 새로운 이야기</span></div>
    <main className="content" id="main-content"><div className="page-head"><div><p className="eyebrow">{page === "inbox" ? "COLLECT & CREATE" : page === "saved" ? "YOUR COLLECTION" : page === "team" ? "BETTER TOGETHER" : "ROOM FOR NEW IDEAS"}</p><h1>{labels[page]}<span className="title-dot">.</span></h1><p className="page-description">{descriptions[page]}</p></div><div className="page-total"><strong>{page === "team" ? data.allowlist.length : data.materials.length}</strong><span>{page === "team" ? "함께하는 팀원" : page === "trashed" ? "삭제한 소재" : "모아둔 소재"}</span></div></div>
      {notice && <div role="alert" className="notice">{notice}<button className="icon-button" aria-label="알림 닫기" onClick={() => setNotice("")}><Icon name="close" /></button></div>}
      {page === "team" ? <div className="team-layout"><form className="team-form" onSubmit={event => { event.preventDefault(); void manage("add", newEmail); }}><span className="section-icon"><Icon name="team" /></span><h2>함께할 팀원 초대</h2><p>팀원이 사용할 Google 계정 이메일을 입력해 주세요.</p><label htmlFor="team-email">이메일 주소</label><div><input id="team-email" type="email" required value={newEmail} onChange={event => setNewEmail(event.target.value)} placeholder="name@example.com"/><button className="primary">추가</button></div></form><section className="team-list"><h2>워크스페이스 멤버 <span>{data.allowlist.length}</span></h2>{data.allowlist.map(row => <div key={row.email}><span className="avatar">{row.email.slice(0, 1).toUpperCase()}</span><div className="member-info"><strong>{row.email}</strong><small>{kst(row.added_at)} 추가</small></div><span className={`role-badge ${row.role}`}>{row.role === "admin" ? "관리자" : "팀원"}</span>{row.role === "member" && <button className="quiet-button" onClick={() => void manage("remove", row.email)}>제거</button>}</div>)}</section></div> : <>
        {page !== "trashed" && <div className="filter-area"><div className="filters"><label className="search-field"><span className="sr-only">소재 검색</span><Icon name="search" /><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="어떤 소재를 찾고 있나요?" /></label>{page === "saved" ? <label className="sort-field"><span className="sr-only">정렬</span><select value={sort} onChange={event => setSort(event.target.value as "saved" | "rating")}><option value="saved">최근 저장순</option><option value="rating">별점 높은 순</option></select></label> : <span className="filter-hint">본문부터 팀원의 댓글까지 검색해 보세요</span>}</div><div className="category-row" role="group" aria-label="소재 분류">{categories.map(value => <button key={value} type="button" className={category === value ? "category-chip active" : "category-chip"} aria-pressed={category === value} onClick={() => setCategory(value)}>{value}{value === "전체" && <span>{data.materials.length}</span>}</button>)}</div></div>}
        {page === "trashed" && <div className="retention-note"><Icon name="trashed" /><span>휴지통으로 옮긴 소재는 {data.retentionDays}일 후 자동으로 삭제돼요. 그전에는 언제든 복구할 수 있어요.</span></div>}
        <div className="results-heading"><span>{query || category !== "전체" ? "검색 결과" : page === "inbox" ? "새롭게 발견한 소재" : page === "saved" ? "저장한 소재" : "휴지통의 소재"}<strong>{displayed.length}</strong></span><span>{page === "inbox" ? "최근 수집순" : page === "saved" ? sort === "rating" ? "별점 높은 순" : "최근 저장순" : "최근 삭제순"}</span></div>
        {displayed.length === 0 ? <div className="empty"><span className="empty-icon"><Icon name={query || category !== "전체" ? "search" : page} /></span><h2>{query || category !== "전체" ? "찾으시는 소재가 없어요" : page === "saved" ? "좋은 소재를 위한 빈자리" : page === "trashed" ? "휴지통이 비어 있어요" : "새로운 이야기를 기다리고 있어요"}</h2><p>{query || category !== "전체" ? "다른 검색어를 입력하거나 분류를 바꿔보세요." : page === "saved" ? "마음에 드는 소재를 저장하면 이곳에 모아드려요." : page === "trashed" ? "삭제한 소재는 이곳에서 확인하고 복구할 수 있어요." : "소재가 도착하면 이곳에서 함께 살펴볼 수 있어요."}</p>{query || category !== "전체" ? <button onClick={() => { setQuery(""); setCategory("전체"); }}>필터 초기화</button> : page === "saved" && <Link className="button-link" href="/">소재 둘러보기 <span aria-hidden="true">→</span></Link>}</div> : page === "inbox" ? groups.map(id => <section key={id} className="batch"><h2><span className="batch-dot" />{batchMap.get(id) ? batchTitle(batchMap.get(id)!.received_at) : "회차"}<span className="batch-count">{displayed.filter(material => material.batch_id === id).length}</span></h2><div className="grid">{displayed.filter(material => material.batch_id === id).map(card)}</div></section>) : <div className="grid">{displayed.map(card)}</div>}
      </>}
      <footer className="content-footer"><span>소재함</span>작은 발견이 콘텐츠가 되는 곳</footer>
    </main></div></div>;
}
