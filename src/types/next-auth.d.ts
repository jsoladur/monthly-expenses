// ============================================================================
// Module augmentation for Auth.js v5 (UC-01).
//
// Adds the internal `app_user.id` to the `User` and `Session` types so that
// `requireUserId()` can read `session.user.id` with full type safety. The
// `jwt` callback in `src/auth.ts` is responsible for placing the internal id
// on the token (not the OAuth sub); this file only documents the contract.
// ============================================================================

import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface User {
    id?: string;
  }

  interface Session {
    user: {
      id: string;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    userId?: string;
  }
}

export {};
