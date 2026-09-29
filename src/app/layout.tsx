import type { Metadata } from "next";
import { Heebo } from "next/font/google";
import "./globals.css";

/** Heebo covers Hebrew and Latin in one family, so mixed text stays even. */
const heebo = Heebo({
  variable: "--font-heebo",
  subsets: ["hebrew", "latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "אנליסט הנדל״ן — Madlan",
  description:
    "שאלו שאלות בעברית על עסקאות נדל״ן שבוצעו, וקבלו ניתוח מבוסס נתונים בלבד.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="he" dir="rtl" className={`${heebo.variable} h-full`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
