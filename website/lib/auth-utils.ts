import { getAuth } from "firebase-admin/auth";

export async function verifySessionCookie(cookieHeader?: string) {
  const cookie = parseCookie(cookieHeader || "");
  const token = cookie["__session"];
  if (!token) throw new Error("NO_AUTH");
  const decoded = await getAuth().verifySessionCookie(token, true);
  return decoded; // contains uid, email, etc.
}

function parseCookie(c: string) {
  return Object.fromEntries(c.split(/; */).map(kv => kv.split("=")));
}

export async function requireAuth(request: Request) {
  try {
    const cookieHeader = request.headers.get('cookie') || '';
    return await verifySessionCookie(cookieHeader);
  } catch {
    throw new Error("NO_AUTH");
  }
}
