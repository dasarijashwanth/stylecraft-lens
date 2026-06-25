import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { Toaster } from "sonner";
import "./globals.css";

export const metadata: Metadata = {
  title: "Stylecraft Lens — Competitive Intelligence",
  description: "Know your competition. Own your market. AI-powered competitive intelligence SaaS for the creative, grooming, and beauty industry.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  const useClerk = !!publishableKey && publishableKey !== "pk_..." && publishableKey !== "";

  const content = (
    <>
      {children}
      <Toaster theme="dark" position="top-right" closeButton richColors />
    </>
  );

  if (useClerk) {
    return (
      <html lang="en">
        <ClerkProvider publishableKey={publishableKey}>
          <body className="bg-bg text-text-primary antialiased">
            {content}
          </body>
        </ClerkProvider>
      </html>
    );
  }

  return (
    <html lang="en">
      <body className="bg-bg text-text-primary antialiased">
        {content}
      </body>
    </html>
  );
}
