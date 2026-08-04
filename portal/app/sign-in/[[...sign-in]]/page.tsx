import { SignIn } from "@clerk/nextjs";

const appOrigin = process.env.NEXT_PUBLIC_APP_URL || "https://app.onyx-iron.com";
const signUpUrl = `${appOrigin}/sign-up`;
const fallbackRedirectUrl = `${appOrigin}/dashboard`;
const signUpFallbackRedirectUrl = `${appOrigin}/dashboard`;

export default function SignInPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-950">
      <SignIn
        path="/sign-in"
        routing="path"
        signUpUrl={signUpUrl}
        fallbackRedirectUrl={fallbackRedirectUrl}
        signUpFallbackRedirectUrl={signUpFallbackRedirectUrl}
      />
    </main>
  );
}
