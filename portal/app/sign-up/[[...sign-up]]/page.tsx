import { SignUp } from "@clerk/nextjs";
import { getAppOrigin } from "@/lib/appUrl";

const appOrigin = getAppOrigin();
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
