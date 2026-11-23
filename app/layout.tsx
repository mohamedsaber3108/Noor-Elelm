import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: {default:"نور العلم | تعلّم الإسلام بثقة",template:"%s | نور العلم"},
  description:"مسارات تعليمية بصرية لفهم الإسلام، مع مصادر واضحة ومراجعة علمية للمحتوى قبل نشره.",
  icons:{icon:"/favicon.svg"},
};
export default function RootLayout({children}:{children:React.ReactNode}) {return <html lang="ar" dir="rtl"><body>{children}</body></html>}
