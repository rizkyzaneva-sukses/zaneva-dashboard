import type { Metadata } from "next";
import { ThemeScript } from "@/components/theme-script";
import { Toaster } from "sonner";
import "./globals.css";

export const metadata: Metadata = {
  title: "Zaneva Dashboard",
  description: "Dashboard omzet konsolidasi semua brand & marketplace",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id" suppressHydrationWarning>
      <head>
        <ThemeScript />
      </head>
      <body className="antialiased">
        {children}
        <Toaster richColors position="top-right" />
      </body>
    </html>
  );
}
