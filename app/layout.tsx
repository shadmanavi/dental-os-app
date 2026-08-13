import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import TopNav from "./components/TopNav";

// Root layout — v2
// Changelog:
//   v1  create-next-app default.
//   v2  Renders the shared TopNav above every page, and carries a real title
//       and description instead of the scaffold's.

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Dental OS",
  description: "Practice tools for Greenwood Dental Services.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-[#F7F6F3]">
        <TopNav />
        {children}
      </body>
    </html>
  );
}
