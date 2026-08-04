import { SignUp } from "@clerk/nextjs";

const appOrigin = process.env.NEXT_PUBLIC_APP_URL || "https://app.onyx-iron.com";
const signInUrl = `${appOrigin}/sign-in`;
const fallbackRedirectUrl = `${appOrigin}/dashboard`;

export default function SignUpPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-950">
      <SignUp
        path="/sign-up"
        routing="path"
        signInUrl={signInUrl}
        fallbackRedirectUrl={fallbackRedirectUrl}
      />
    </main>
  );
}
