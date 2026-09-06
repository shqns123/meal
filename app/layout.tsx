import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "우리집 식탁",
  description: "가족을 위한 똑똑한 식단 플래너",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icon.svg", apple: "/icon.svg" },
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="ko"><body>{children}</body></html>; }
