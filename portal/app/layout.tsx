import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import DeploymentVersionGuard from "@/components/app/DeploymentVersionGuard";
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
const deploymentVersion = process.env.VERCEL_DEPLOYMENT_ID
  ?? process.env.VERCEL_GIT_COMMIT_SHA
  ?? appOrigin;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const content = (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <DeploymentVersionGuard version={deploymentVersion} />
        {children}
      </body>
    </html>
  );
  if (process.env.PLAYWRIGHT_TEST_MODE === "1") return content;
  return (
    <ClerkProvider
      signInUrl={clerkSignInUrl}
      signUpUrl={clerkSignUpUrl}
      signInFallbackRedirectUrl={clerkAfterSignInUrl}
      signUpFallbackRedirectUrl={clerkAfterSignUpUrl}
    >
      {content}
    </ClerkProvider>
  );
}
