import type { Metadata } from "next";
import { Noto_Sans_SC, Noto_Serif_SC, Geist_Mono } from "next/font/google";
import "./globals.css";

const sans = Noto_Sans_SC({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const serif = Noto_Serif_SC({
  variable: "--font-serif",
  subsets: ["latin"],
  weight: ["400", "600", "700"],
  display: "swap",
});

const mono = Geist_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "琅嬛 Langhuan",
  description: "私人藏书阁 · 本地 Markdown / HTML 知识库",
};

const themeScript = `
(function(){
  try {
    var theme = localStorage.getItem('langhuan-theme');
    if (!theme) {
      var raw = localStorage.getItem('langhuan-store');
      if (raw) {
        var parsed = JSON.parse(raw);
        theme = parsed && parsed.state && parsed.state.theme;
      }
    }
    if (theme === 'ink') document.documentElement.classList.add('dark');
  } catch (e) {}
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className={`${sans.variable} ${serif.variable} ${mono.variable} antialiased`}>
        {children}
      </body>
    </html>
  );
}
