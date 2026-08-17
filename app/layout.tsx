import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import TopNav from "./components/TopNav";
import ServiceWorkerRegistrar from "./components/ServiceWorkerRegistrar";

// Root layout — v3
// Changelog:
//   v1  create-next-app default.
//   v2  Renders the shared TopNav above every page, and carries a real title
//       and description instead of the scaffold's.
//   v3  Makes the app installable on tablets.
//
//       Three things had to be true and none of them were. The manifest
//       lives in app/manifest.ts and Next links it automatically, so that
//       part is not here. What is here is the iOS half and the viewport.
//
//       appleWebApp is the iPad half of "standalone". Safari does not read
//       the manifest's display field at all — it reads its own meta tag, and
//       without it Add to Home Screen produces a bookmark that opens in
//       Safari with the address bar still there. statusBarStyle
//       "black-translucent" lets the app paint under the status bar, which
//       is why viewportFit is set to cover below.
//
//       The viewport export is the difference between an app and a web page
//       on a tablet. maximumScale and userScalable stop a stray pinch from
//       leaving the charting grid zoomed for the next person; viewportFit
//       "cover" fills the display instead of letterboxing inside the safe
//       area. Any element that must clear the notch or home indicator uses
//       env(safe-area-inset-*) in CSS — the viewport setting is what makes
//       those values non-zero.
//
//       ServiceWorkerRegistrar is last in the body because it renders
//       nothing. It exists because Chrome will not offer Install without a
//       service worker that handles fetch.

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
  applicationName: "Dental OS",
  appleWebApp: {
    capable: true,
    title: "Dental OS",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  themeColor: "#2C4E54",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
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
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}
