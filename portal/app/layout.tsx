import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Onyx Intel",
  description: "AI-native construction workspace",
};

const appOrigin = process.env.NEXT_PUBLIC_APP_URL || "https://app.onyx-iron.com";
const clerkSignInUrl = `${appOrigin}/sign-in`;
const clerkSignUpUrl = `${appOrigin}/sign-up`;
const clerkAfterSignInUrl = `${appOrigin}/dashboard`;
const clerkAfterSignUpUrl = `${appOrigin}/dashboard`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider
      signInUrl={clerkSignInUrl}
      signUpUrl={clerkSignUpUrl}
      signInFallbackRedirectUrl={clerkAfterSignInUrl}
      signUpFallbackRedirectUrl={clerkAfterSignUpUrl}
    >
      <html
        lang="en"
        className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      >
        <body className="min-h-full flex flex-col">{children}</body>
      </html>
    </ClerkProvider>
  );
}
