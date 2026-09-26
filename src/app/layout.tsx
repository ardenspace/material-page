import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "소재함", description: "강원도 콘텐츠 소재를 함께 고르는 보드" };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ko"><body>{children}</body></html>;
}
