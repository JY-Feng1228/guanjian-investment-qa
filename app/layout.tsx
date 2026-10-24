import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "观鉴 · 投资回答质检",
  description: "从事实核验到人工复核，让每一个投资问答判断有据可查。",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">{children}</body>
    </html>
  );
}
