import LinkedIn from "next-auth/providers/linkedin";
import type { NextAuthConfig } from "next-auth";

/**
 * Edge-safe half of the Auth.js configuration.
 *
 * This file must NOT import Prisma, the Prisma adapter, or anything that pulls
 * in Node built-ins: `src/middleware.ts` runs on the edge runtime and imports
 * this module. The database adapter is attached separately in `src/auth.ts`,
 * which only ever runs in the Node.js runtime.
 *
 * The built-in LinkedIn provider is already configured for OpenID Connect with
 * issuer https://www.linkedin.com/oauth, `client_secret_post` token auth, and
 * state-only checks (LinkedIn does not support PKCE), so no overrides are
 * needed here. It reads AUTH_LINKEDIN_ID / AUTH_LINKEDIN_SECRET from the
 * environment automatically.
 *
 * Scopes are limited to `openid profile email`. LinkedIn does not expose a
 * member's connections to third-party apps at any scope — the connection graph
 * comes from the user's own data export instead. See README.
 */
const PROTECTED_PREFIXES = [
  "/dashboard",
  "/onboarding",
  "/connections",
  "/tracker",
  "/settings",
] as const;

export const authConfig = {
  providers: [LinkedIn],

  pages: {
    // The landing page doubles as the sign-in page.
    signIn: "/",
    error: "/",
  },

  callbacks: {
    /**
     * Consulted by the middleware wrapper on every matched request. Returning
     * false makes Auth.js redirect to the `signIn` page above.
     */
    authorized({ auth, request }) {
      const isLoggedIn = Boolean(auth?.user);
      const isProtected = PROTECTED_PREFIXES.some((prefix) =>
        request.nextUrl.pathname.startsWith(prefix),
      );

      return isProtected ? isLoggedIn : true;
    },
  },
} satisfies NextAuthConfig;
