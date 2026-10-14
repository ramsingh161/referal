import NextAuth from "next-auth";

import { authConfig } from "@/auth.config";

/**
 * Route protection.
 *
 * Next.js 16 replaced the `middleware.ts` convention with `proxy.ts`. The
 * handler is exported as a plain default export because Next statically
 * analyses this file for a function export, and a destructured
 * `export const { auth: proxy }` is not recognised as one.
 *
 * This intentionally builds its own NextAuth instance from the edge-safe
 * `authConfig` rather than importing `@/auth`: the latter attaches the Prisma
 * adapter, which cannot run in this runtime. The `authorized` callback in
 * auth.config.ts decides which paths require a session.
 */
const { auth } = NextAuth(authConfig);

export default auth;

export const config = {
  /**
   * Everything except Next internals, the auth endpoints, and static assets.
   * Matching /api/auth/* here would intercept the OAuth callback and break
   * sign-in.
   */
  matcher: [
    "/((?!api/auth|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
