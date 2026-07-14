import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Lebanon Ecom OS",
  description: "Founder OS for importing and selling one SKU in Lebanon",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
