import { encode } from "next-auth/jwt";
import postgres from "postgres";

// ============================================================================
// Playwright auth helper (UC-01 + UC-03 e2e).
//
// The app uses Auth.js v5 with Google OAuth. E2E tests can't reasonably
// perform the real OAuth dance against Google — instead we seed an
// `app_user` row directly and forge an Auth.js session cookie signed with
// the same `AUTH_SECRET` the app uses. The cookie decodes to the same
// shape the `jwt` callback would produce after a real sign-in.
//
// Cookie name: `authjs.session-token` (the non-secure variant because the
// e2e runs against `http://localhost:3000`). For production (`https://`)
// Auth.js uses `__Secure-authjs.session-token` instead.
//
// All operations are idempotent; the helper inserts the user only if it
// doesn't already exist.
//
// UC-31: like sign-in, the helper also provisions the user's PRIVATE
// workspace and its Owner membership. Test-only convenience: the private
// workspace is created with `id = app_user.id`, so specs that seed rows in
// SQL can write `workspace_id = ${user.id}` (or `user.workspaceId`). The app
// never relies on that equality — it always resolves the workspace by
// membership.
// ============================================================================

const COOKIE_NAME = "authjs.session-token";
const DEFAULT_EMAIL = "e2e-categories@example.com";
const DEFAULT_SUB = "e2e-categories-sub";

export interface E2EUser {
  id: string;
  email: string;
  /** The user's private workspace (UC-31). Equals `id` for helper-seeded users. */
  workspaceId: string;
}

export async function ensureUser(
  url: string,
  secret: string,
  opts: { email?: string; googleSub?: string } = {},
): Promise<E2EUser> {
  const email = opts.email ?? DEFAULT_EMAIL;
  const googleSub = opts.googleSub ?? DEFAULT_SUB;
  const db = postgres(url, { max: 1, prepare: false });
  try {
    const rows = await db<{ id: string; email: string }[]>`
      INSERT INTO app_user (google_sub, email)
      VALUES (${googleSub}, ${email})
      ON CONFLICT (google_sub) DO UPDATE SET email = EXCLUDED.email
      RETURNING id, email
    `;
    if (!rows[0]) throw new Error("ensureUser: insert returned no row");
    const userId = rows[0].id;
    await db`
      INSERT INTO workspace (id, kind, personal_user_id, currency)
      VALUES (${userId}, 'private', ${userId}, 'EUR')
      ON CONFLICT DO NOTHING
    `;
    const [ws] = await db<{ id: string }[]>`
      SELECT id FROM workspace WHERE personal_user_id = ${userId}
    `;
    if (!ws) throw new Error("ensureUser: private workspace missing");
    await db`
      INSERT INTO workspace_member (workspace_id, user_id, role)
      VALUES (${ws.id}, ${userId}, 'owner')
      ON CONFLICT DO NOTHING
    `;
    return { id: userId, email: rows[0].email, workspaceId: ws.id };
  } finally {
    await db.end({ timeout: 1 });
  }
}

export async function buildSessionCookie(opts: {
  secret: string;
  userId: string;
  email: string;
  maxAgeSeconds?: number;
}): Promise<{ name: string; value: string; domain: string; path: string }> {
  const maxAge = opts.maxAgeSeconds ?? 60 * 60;
  const token = await encode({
    token: {
      userId: opts.userId,
      name: opts.email,
      email: opts.email,
      sub: opts.userId,
    },
    secret: opts.secret,
    salt: COOKIE_NAME,
    maxAge,
  });
  return {
    name: COOKIE_NAME,
    value: token,
    domain: "localhost",
    path: "/",
  };
}
