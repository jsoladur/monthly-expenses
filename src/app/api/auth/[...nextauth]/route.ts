import { handlers } from "@/auth";

// ============================================================================
// Auth.js v5 route handler (UC-01).
//
// Mounts the `GET` and `POST` handlers Auth.js exposes for the entire
// `/api/auth/*` surface (sign-in, callback, session, csrf, providers, etc.).
// Google redirect URIs must include
//   https://expenses.jmsola.dev/api/auth/callback/google
//   http://localhost:3000/api/auth/callback/google
// (ARCH §3.2 rule 5).
// ============================================================================

export const { GET, POST } = handlers;
