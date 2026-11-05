/**
 * Edge workers run with the service role and trust ids in the body.
 * The function gateway accepts any project JWT, including the publishable
 * anon key shipped in the browser. Callers that are allowed to mutate
 * documents or catalog prices already send the service-role bearer
 * (portal invoke, worker fan-out, and the commodity cron).
 */

export function serviceRoleAuthorized(
  authorization: string | null,
  serviceRoleKey: string,
): boolean {
  if (!serviceRoleKey) return false;
  const token = bearerToken(authorization);
  if (!token) return false;
  return timingSafeEqual(token, serviceRoleKey);
}

export function rejectUnlessServiceRole(req: Request, serviceRoleKey: string): Response | null {
  if (serviceRoleAuthorized(req.headers.get("Authorization"), serviceRoleKey)) return null;
  return new Response(JSON.stringify({ error: "Unauthorized" }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
}

function bearerToken(authorization: string | null): string {
  if (!authorization) return "";
  const prefix = "Bearer ";
  if (!authorization.startsWith(prefix)) return "";
  return authorization.slice(prefix.length).trim();
}

function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const left = enc.encode(a);
  const right = enc.encode(b);
  const len = Math.max(left.length, right.length);
  let diff = left.length === right.length ? 0 : 1;
  for (let i = 0; i < len; i++) {
    diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  }
  return diff === 0;
}
