import "server-only";

import { auth, currentUser } from "@clerk/nextjs/server";

export class PlatformAdminError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "PlatformAdminError";
  }
}

function configuredAdminEmails(): ReadonlySet<string> {
  return new Set(
    (process.env.ONYX_PLATFORM_ADMIN_EMAILS ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function isPlatformAdminEmail(email: string | null | undefined): boolean {
  return !!email && configuredAdminEmails().has(email.trim().toLowerCase());
}

export async function requirePlatformAdmin(): Promise<{ userId: string; email: string }> {
  const { userId } = await auth();
  if (!userId) throw new PlatformAdminError("Unauthorized", 401);
  const email = (await currentUser())?.primaryEmailAddress?.emailAddress?.trim().toLowerCase() ?? "";
  if (configuredAdminEmails().size === 0) {
    throw new PlatformAdminError("Platform administration is not configured", 503);
  }
  if (!isPlatformAdminEmail(email)) throw new PlatformAdminError("Forbidden", 403);
  return { userId, email };
}
