import { SignUp } from "@clerk/nextjs";

const signInUrl = process.env.NEXT_PUBLIC_CLERK_SIGN_IN_URL || "/sign-in";
const fallbackRedirectUrl =
  process.env.NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL || "/dashboard";

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
