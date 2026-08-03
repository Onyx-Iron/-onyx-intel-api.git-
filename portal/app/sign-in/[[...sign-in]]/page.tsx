import { SignIn } from "@clerk/nextjs";

const signUpUrl = process.env.NEXT_PUBLIC_CLERK_SIGN_UP_URL || "/sign-up";
const fallbackRedirectUrl =
  process.env.NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL || "/dashboard";
const signUpFallbackRedirectUrl =
  process.env.NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL || "/dashboard";

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
