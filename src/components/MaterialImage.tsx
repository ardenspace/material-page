"use client";

import { useState } from "react";
import Icon from "@/components/Icon";

export default function MaterialImage({ src }: { src: string | null }) {
  const [failed, setFailed] = useState(false);
  return <div className="material-media">
    {src && !failed ?
      // Static export serves external post images without an optimization server.
      // eslint-disable-next-line @next/next/no-img-element
      <img className="post-image" src={src} alt="게시물 첫 사진" loading="lazy" onError={() => setFailed(true)} /> :
      <div className="media-placeholder"><Icon name="inbox" /><span>{failed ? "이미지를 불러오지 못했어요" : "텍스트 소재"}</span></div>}
  </div>;
}
