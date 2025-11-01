import { getAuth } from "firebase-admin/auth";

/**
 * Verifies a Firebase session cookie and returns the decoded token with user information.
 * 
 * @param {string} cookieHeader - The cookie header string containing the session cookie
 * @returns {Promise<Object>} Decoded session cookie token containing uid, email, etc.
 * @throws {Error} Throws error with message "NO_AUTH" if cookie is missing or invalid
 */
export async function verifySessionCookie(cookieHeader?: string) {
  const cookie = parseCookie(cookieHeader || "");
  const token = cookie["__session"];
  if (!token) throw new Error("NO_AUTH");
  const decoded = await getAuth().verifySessionCookie(token, true);
  return decoded; // contains uid, email, etc.
}

/**
 * Parses a cookie header string into a key-value object.
 * 
 * @param {string} c - The cookie header string to parse
 * @returns {Record<string, string>} Object with cookie names as keys and values as values
 */
function parseCookie(c: string) {
  return Object.fromEntries(c.split(/; */).map(kv => kv.split("=")));
}

/**
 * Requires authentication by verifying the session cookie from the request.
 * Throws an error if authentication fails.
 * 
 * @param {Request} request - The incoming request object
 * @returns {Promise<Object>} Decoded session cookie token with user information
 * @throws {Error} Throws error with message "NO_AUTH" if authentication fails
 */
export async function requireAuth(request: Request) {
  try {
    const cookieHeader = request.headers.get('cookie') || '';
    return await verifySessionCookie(cookieHeader);
  } catch {
    throw new Error("NO_AUTH");
  }
}
