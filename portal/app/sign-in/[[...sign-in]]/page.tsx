import { SignIn } from "@clerk/nextjs";
import { getAppOrigin } from "@/lib/appUrl";

const appOrigin = getAppOrigin();
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
