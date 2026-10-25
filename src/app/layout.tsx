import type { Metadata, Viewport } from "next";
import { Inter, Noto_Sans_Arabic, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const notoArabic = Noto_Sans_Arabic({
  subsets: ["arabic"],
  variable: "--font-noto-arabic",
  display: "swap",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Nanote — Your handwriting, beautifully organized",
  description:
    "Nanote is a local-first handwriting notes app: pressure-sensitive pens, PDF annotation, synced audio notes, folders, tags and PDF export. 100% free, 100% offline, no accounts.",
  applicationName: "Nanote",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F7F9FC" },
    { media: "(prefers-color-scheme: dark)", color: "#0E1622" },
  ],
};

const preHydrate = `(function(){try{var s=JSON.parse(localStorage.getItem('nanote.settings')||'{}');var d=document.documentElement;if(s.lang==='ar'){d.lang='ar';d.dir='rtl'}else{d.lang='en';d.dir='ltr'}var th=s.theme||'system';var dark=th==='dark'||(th==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);if(dark){d.classList.add('dark')}d.style.colorScheme=dark?'dark':'light'}catch(e){}})()`;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" dir="ltr" suppressHydrationWarning>
      <body
        className={`${inter.variable} ${notoArabic.variable} ${geistMono.variable} antialiased bg-background text-foreground min-h-screen`}
      >
        <script dangerouslySetInnerHTML={{ __html: preHydrate }} />
        {children}
        <Toaster position="bottom-center" richColors closeButton />
      </body>
    </html>
  );
}
