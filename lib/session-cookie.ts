// Kept in its own file so middleware (Edge runtime) can import it without
// pulling in Prisma, bcrypt or Node's crypto from lib/auth.ts.
export const SESSION_COOKIE = "session_token";
