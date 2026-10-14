import { PrismaAdapter } from "@auth/prisma-adapter";
import NextAuth from "next-auth";

import { authConfig } from "@/auth.config";
import { prisma } from "@/lib/db";

/**
 * Full Auth.js configuration — Node.js runtime only, because the Prisma adapter
 * cannot run on the edge. `src/middleware.ts` deliberately uses the leaner
 * `authConfig` instead of this module.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,

  adapter: PrismaAdapter(prisma),

  /**
   * JWT sessions rather than database sessions. Two reasons:
   *   1. The middleware can verify a session without a database round-trip,
   *      which keeps route protection on the edge runtime.
   *   2. No per-request query just to resolve the current user.
   * The adapter still persists User and Account rows on first sign-in, so the
   * relational model (connections, matches, asks) works exactly the same.
   */
  session: { strategy: "jwt" },

  callbacks: {
    ...authConfig.callbacks,

    /**
     * Surface the user id on the session. Every query touching connection data
     * is scoped by it, so it has to be reliably present — see the privacy
     * helpers in src/lib/db.ts.
     */
    session({ session, token }) {
      if (token.sub) {
        session.user.id = token.sub;
      }
      return session;
    },
  },

  events: {
    /**
     * Denormalise the LinkedIn OIDC `sub` onto User.linkedinSub. It is already
     * available as Account.providerAccountId, but keeping a copy on User avoids
     * a join on the hot path and gives the column a stable meaning if other
     * providers are ever added.
     */
    async linkAccount({ user, account }) {
      if (account.provider !== "linkedin" || !user.id) return;

      await prisma.user.update({
        where: { id: user.id },
        data: { linkedinSub: account.providerAccountId },
      });
    },
  },
});
