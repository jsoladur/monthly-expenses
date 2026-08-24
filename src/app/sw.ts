// ============================================================================
// PWA service worker (ADR-7, PRD C11).
//
// Precaches the app shell only; `runtimeCaching` stays EMPTY — the app is
// online-only (PRD C11), no API/data responses are ever cached.
//
// `navigationPreload` MUST stay disabled. With it enabled, Serwist's
// `StrategyHandler.fetch()` consumes `event.preloadResponse` for navigations
// and — during service-worker lifecycle races (an SW update taking over via
// `skipWaiting` + `clientsClaim` mid-navigation) — the preload response is
// unavailable, so the SW issues a second network fetch and the same request
// reaches the server TWICE. For `/api/auth/callback/google` that consumes the
// single-use OAuth authorization code twice; Google rejects the second token
// exchange with `invalid_grant` (CallbackRouteError → "Access Denied"), which
// only reproduces in browsers that actually run the SW (never in incognito).
// See serwist/serwist#150 and serwist/serwist discussion #28.
//
// Navigation preload is a REGISTRATION-level flag: versions <= 0.1.2 called
// `enable()` and the flag SURVIVES service-worker updates. A new worker that
// merely omits the option would inherit the enabled preload, so the activate
// handler below explicitly `disable()`s it — the first update past 0.1.3
// turns it off for good.
// ============================================================================

import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { Serwist } from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope & WorkerGlobalScope;

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  runtimeCaching: [],
});

serwist.addEventListeners();

self.addEventListener("activate", (event) => {
  event.waitUntil(
    self.registration?.navigationPreload?.disable().catch(() => undefined),
  );
});
