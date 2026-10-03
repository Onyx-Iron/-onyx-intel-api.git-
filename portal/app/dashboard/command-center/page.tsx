import { redirect } from "next/navigation";

/** Canonical Command Center is /dashboard — keep this URL as a redirect. */
export default function CommandCenterRedirectPage() {
  redirect("/dashboard");
}
