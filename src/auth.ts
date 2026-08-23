import NextAuth, { type NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";
import { isAllowlisted, parseAllowlist } from "@/server/auth/allowlist";
import { findUserByGoogleSub } from "@/server/repositories/user";
import { upsertUserOnSignIn } from "@/server/services/auth";

// ============================================================================
// Auth.js v5 — Google provider + env-var email allowlist (UC-01, ADR-2, ADR-3).
//
// Sign-in flow (PRD C3, ARCH §3.1, §3.2):
//   1. `signIn` callback: normalize email (trim + lowercase) and check against
//      `ALLOWED_EMAILS`. Return `false` → user lands on `/[locale]/403`
//      (PRD C3). Returning `false` also drops any partial state (no session,
//      no DB row) — `signIn` only commits the upsert after the allowlist
//      check passes (ARCH §3.2 rule 2).
//   2. On allow: upsert `app_user` by `google_sub`. On first insert, also
//      insert `profile_settings(currency='EUR')` in the same transaction
//      (PRD UC-01, §5.3).
//   3. `jwt` callback resolves the internal `app_user.id` by `google_sub`
//      on first sign-in and stores it on the token. `session` callback
//      exposes it as `session.user.id`. Server code never trusts
//      client-supplied user ids (ARCH §3.2 rule 3) — `requireUserId()` reads
//      it from the session via `auth()`.
//   4. `pages.error = '/403'` so the built-in error route renders our i18n
//      403 page (UC-01 screen 2).
//
// Session strategy: JWT (ADR-3). We don't use an Auth.js DB adapter because
// our `app_user` table is the source of truth and the JWT carries the
// internal id directly. `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`
// come from env (ARCH §3.2 rule 5); `AUTH_GOOGLE_ID/SECRET` are inferred
// from the provider id by Auth.js v5, but we read them explicitly to keep
// the link obvious and to make local-dev failures self-explanatory.
// ============================================================================

function getAllowedEmails(): ReadonlySet<string> {
  return parseAllowlist(process.env.ALLOWED_EMAILS);
}

export const authConfig: NextAuthConfig = {
  trustHost: true,
  secret: process.env.AUTH_SECRET,
  session: { strategy: "jwt" },
  pages: {
    signIn: "/sign-in",
    error: "/403",
  },
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
    }),
  ],
  callbacks: {
    async signIn({ profile }) {
      const allowlist = getAllowedEmails();
      if (!isAllowlisted(profile?.email, allowlist)) {
        // Denied users get NO session and NO database rows (PRD C3,
        // ARCH §3.2 rule 2). The user upsert has not run yet.
        return false;
      }
      const googleSub = profile?.sub;
      if (typeof googleSub !== "string" || googleSub.length === 0) {
        return false;
      }
      const email = profile?.email;
      if (typeof email !== "string" || email.length === 0) {
        return false;
      }
      // First-time provisioning lives in the service so the transaction is
      // owned by the domain layer (ARCH §5 rule 3). On repeat sign-ins the
      // service is a cheap lookup.
      await upsertUserOnSignIn({
        googleSub,
        email,
        displayName: profile?.name ?? null,
        avatarUrl: profile?.picture ?? null,
      });
      return true;
    },
    async jwt({ token, user }) {
      // `user` is only populated on first sign-in (the OAuth profile).
      // The OAuth `user.id` is the Google `sub`, NOT our internal
      // `app_user.id`; resolve the internal id once and cache it on the
      // token so subsequent calls are a JWT lookup only.
      if (user) {
        const googleSub = (user as { id?: string }).id;
        if (typeof googleSub === "string" && googleSub.length > 0) {
          const internal = await findUserByGoogleSub(googleSub);
          if (internal) {
            token.userId = internal.id;
          }
        }
      }
      return token;
    },
    async session({ session, token }) {
      const userId = (token as { userId?: string }).userId;
      if (typeof userId === "string" && userId.length > 0 && session.user) {
        session.user.id = userId;
      }
      return session;
    },
  },
};

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);
