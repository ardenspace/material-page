"use client";
import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { kst, type Comment, type Profile, type Rating } from "@/lib/model";

type Props = { id: string; userId: string; comments: Comment[]; ratings: Rating[]; profiles: Map<string, Profile>; readonly: boolean; onChanged: () => void; onError: (message: string) => void };

export default function Feedback({ id, userId, comments, ratings, profiles, readonly, onChanged, onError }: Props) {
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const mine = ratings.find(rating => rating.author_id === userId);
  const average = ratings.length ? ratings.reduce((sum, rating) => sum + rating.score, 0) / ratings.length : 0;
  const run = async (action: () => PromiseLike<{ error: { message: string } | null }>) => {
    try {
      const { error } = await action();
      if (error) throw error;
      onChanged();
    } catch { onError("변경하지 못했어요. 소재 상태와 권한을 확인해 주세요."); }
  };
  const name = (author: string) => profiles.get(author)?.display_name ?? "이름 없음";
  return <div className="feedback">
    <div className="rating-head"><strong>별점</strong><span>{ratings.length ? `${average.toFixed(1)} / 5 · ${ratings.length}명` : "아직 별점 없음"}</span></div>
    {ratings.length > 0 && <p className="people">{ratings.map(r => `${name(r.author_id)} ${r.score}점`).join(" · ")}</p>}
    {!readonly && <div className="rating-actions" aria-label="내 별점">
      {[1, 2, 3, 4, 5].map(score => <button key={score} type="button" className={mine?.score === score ? "selected" : ""} onClick={() => run(() => supabase().from("ratings").upsert({ material_id: id, author_id: userId, score }, { onConflict: "material_id,author_id" }))}>{score}점</button>)}
      {mine && <button type="button" onClick={() => run(() => supabase().from("ratings").delete().eq("material_id", id).eq("author_id", userId))}>취소</button>}
    </div>}
    <div className="comments-head"><strong>댓글</strong><span>{comments.length}</span></div>
    <div className="comments">{comments.map(comment => <div key={comment.id} className="comment">
      <div className="comment-meta"><strong>{name(comment.author_id)}</strong><time>{kst(comment.created_at)}</time>{comment.updated_at && <span>(수정됨)</span>}</div>
      {editing === comment.id ? <div className="comment-edit"><textarea value={editText} onChange={e => setEditText(e.target.value)} aria-label="댓글 수정"/><button disabled={!editText.trim()} onClick={() => run(async () => { const result = await supabase().from("comments").update({ body: editText.trim() }).eq("id", comment.id); if (!result.error) setEditing(null); return result; })}>저장</button><button onClick={() => setEditing(null)}>취소</button></div> : <p>{comment.body}</p>}
      {!readonly && comment.author_id === userId && editing !== comment.id && <div className="comment-actions"><button onClick={() => { setEditing(comment.id); setEditText(comment.body); }}>수정</button><button onClick={() => { if (window.confirm("댓글을 삭제할까요?")) run(() => supabase().from("comments").delete().eq("id", comment.id)); }}>삭제</button></div>}
    </div>)}</div>
    {!readonly && <form className="comment-form" onSubmit={event => { event.preventDefault(); if (!draft.trim()) return; void run(async () => { const result = await supabase().from("comments").insert({ material_id: id, author_id: userId, body: draft.trim() }); if (!result.error) setDraft(""); return result; }); }}>
      <textarea aria-label="댓글 입력" placeholder="이 소재에 대한 생각을 남겨주세요" value={draft} onChange={event => setDraft(event.target.value)} />
      <button type="submit" disabled={!draft.trim()}>댓글 쓰기</button>
    </form>}
  </div>;
}
