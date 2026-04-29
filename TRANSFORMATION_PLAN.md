# VelisMail: Deep Transformation Roadmap

## 1. Current System Classification

The current system acts as an **MVP (Minimum Viable Product) masquerading as a production system.**

While the backend services are robustly structured into Rust microservices and deploy real databases, the frontend reveals fundamental architectural compromises. The frontend attempts to bridge the gap between offline functionality and online syncing using a "fire-and-forget" background synchronization strategy. Consequently, it treats `localStorage` as a primary datastore, duplicating states and creating a disconnected source of truth.

## 2. Critical Weaknesses

- **Disjointed State Management:** `localStorage` is used as the absolute source of truth on the frontend, heavily caching states ranging from emails to auth data, breaking data integrity with the actual deployed backend.
- **Security Vulnerabilities:** Plaintext passwords were aggressively stored in `localStorage` alongside active user sessions. (Phase 1 intervention deployed to mitigate by moving to hashes, but fundamental architecture remains flawed). Authentication depends on local evaluations instead of purely authoritative remote verification.
- **Silent Failures:** The frontend's "offline-first" approach silently drops critical external communication, assuming mock structures in the absence of valid server connections.
- **Passkey Support Incomplete:** Though passkey login exists within the UI, its backend implementation is stubbed, returning 501 errors, highlighting an incomplete core capability.
- **Fake Dummy Logic:** Remnants of prototype development remain, generating temporary UUIDs or mock entries when external sources should be defining true identity and state.

## 3. What Must Be Removed

- **Client-Side Fake Databases:** The entire fake persistence layer in `frontend/src/api/client.ts` that mocks a backend API with internal states.
- **Synchronous Offline Fallbacks:** Temporary UI hacks designed around immediate state mutations in `localStorage` must be stripped entirely.
- **Frontend Validation of Auth Secrets:** Local password checking must be permanently eliminated.

## 4. What Must Be Redesigned

- **API Interfacing and State Management:** Transition the frontend from local stores to standardized remote queries utilizing tools like `React Query` or `Zustand` directly bound to actual remote backend states.
- **Authentication Lifecycle:** Ensure authentication remains strictly server-authoritative, exclusively issuing JWTs while managing sessions effectively.
- **The Event Driven Data Loop:** Convert fire-and-forget loops into deterministic server synchronization processes, adopting WebSockets or Server-Sent Events (SSE) (since NATS exists on the backend) for live data refreshes.

## 5. What Must Be Added

- **End-to-End Encryption (E2EE):** Given the promise of secure mailboxes, E2EE mechanisms, such as proper PGP implementations or shared secret key exchanges, must be baked natively into the platform.
- **Complete Passkey & ZKP Integration:** Realize the ZKP (Zero-Knowledge Proof) and Passkey implementations on the Rust API side that are currently mocked.
- **Session Governance:** Active session tracking, remote session invalidation, and comprehensive audit logs available in the frontend UI.
- **Advanced Filtering and Search capabilities:** A fully robust server-side search system to retrieve deep email history.

## 6. Security Hardening Plan

- **Shift Auth Authority:** Remove all traces of local password validation; migrate strictly to backend validations returning HTTPOnly secure cookies or safely managed transient tokens.
- **Rate Limiting & Abuse Prevention:** Augment existing Axum middleware with strict API rate limiting, IP tracking, and automatic temporary locks for failed login attempts.
- **Content Security Policies (CSP):** Deploy strict CSP headers limiting domain communication, asset delivery, and execution parameters.
- **Robust XSS & CSRF Mitigation:** Sanitize all incoming mail body inputs thoroughly on the frontend using libraries like DOMPurify. Verify Anti-CSRF mechanisms within API workflows.
- **Full E2E Storage Encryption:** Store all persistent emails encrypted at rest using keys accessible only via user-provided or derived credentials.

## 7. Feature Expansion Plan

- **Real-time Notifications:** WebSocket integration enabling instantaneous notification of incoming emails and backend events.
- **Analytics & Dashboards:** Business-level dashboards detailing delivery successes, bounces, open rates (where requested), and storage quotas.
- **Mail Filtering Rules:** Introduce robust server-side rule processing engines for auto-archiving, routing, and spam defense based on advanced heuristics or custom rules.
- **Unified Identity Management:** Overhaul user models to allow seamless transitions and connections across Personal and Business accounts securely under one parent identity.

## 8. UX/UI Redesign Plan

- **Layout and Hierarchy Revamp:** Shift from purely functional MVP grids to standard premium dashboards. Upgrade spacing and component uniformity.
- **Theming Standardization:** Consolidate visual polish, introducing seamless transitions, comprehensive empty-states, and skeleton loaders in lieu of hard spinners.
- **Trust Metrics:** Provide explicit, visually distinct UI cues marking verified external domains, DKIM/SPF health statuses, and connection reliability markers.
- **Responsive Navigation:** Enhance mobile drawer interfaces and multi-folder deeply nested navigations to feel native rather than responsive.

## 9. Performance and Scalability Plan

- **Efficient Remote Operations:** Strip the frontend bundle size by dropping `localStorage` DB parsers and transitioning to thin-client architectures utilizing memoized API hooks.
- **Pagination and Lazy Loading:** Adopt infinite scroll or standard pagination models on server responses rather than hydrating all emails into memory.
- **Backend Asset Delivery Optimization:** Employ CDNs or structured Blob responses for media and attachments connected to S3 endpoints, bypassing direct application load.

## 10. Code Quality and Maintainability Plan

- **Strong Typing across boundaries:** Establish shared schema (e.g. tRPC or OpenAPI generated clients) bridging Rust and TypeScript configurations.
- **Dead-Code Elimination:** Expunge all client-side stub generation routines, dummy user seeds, and "offline" modes that serve to mask failures.
- **Enhanced Testability:** Mandate e2e testing with Playwright to verify full lifecycle operations across the auth, mailing, and tenant boundaries.

## 11. Versioned Roadmap

### v2.0.0: The Integrity Patch (Immediate)
- **Scope:** Strip plaintext offline risks, enforce server-authority, purge pseudo-database logics.
- **Changes:** Refactor `client.ts` to operate entirely over standard asynchronous fetch calls bounded by accurate state containers (`React Query`).
- **Risk:** High (fundamentally breaks any offline legacy assumptions).
- **Priority:** Critical.

### v3.0.0: The Security Realization
- **Scope:** Secure session governance, deployment of true WebAuthn Passkeys, fully integrated ZKP protocol completions.
- **Changes:** Rust backend completions for `passkey.rs` and frontend integration matching server demands. Implementation of E2E storage encryption at rest.
- **Priority:** High.

### v4.0.0: Premium Workspace
- **Scope:** Complete UI/UX redesign featuring real-time WebSockets, robust Business tier analytics, and advanced filtering capabilities.
- **Changes:** Integration with existing NATS streams to surface real-time notifications, complete frontend graphical overhaul.
- **Priority:** Medium.

## 12. Step-by-Step Transformation Sequence

1. **Purge Local Data Structures:** Modify `client.ts` to deprecate and ignore all offline stores.
2. **Refactor Hooks:** Convert all local-dependent React components to properly handle asynchronous backend responses, utilizing intermediate loading states.
3. **Backend Auth Fulfillment:** Finalize the Rust passkey validation handlers and ensure rigorous password verifications absent of client interference.
4. **Data Sync Layering:** Introduce SSE/WebSocket listeners for mailbox updates replacing current manual/silent background refreshers.
5. **UI Polish & Audit:** Address accessibility, theming, and layout consistency across the new data model.

## 13. Validation and Benchmark Plan

- **Security Verification:** Automated OWASP ZAP scanning of the endpoints ensuring zero credentials pass locally outside HTTPS bodies, nor persist openly within browser stores.
- **End-to-End Suite:** Execute a comprehensive suite spanning account creation -> verification -> live mail sending to external SMTP integrations, failing upon any UI silent errors.
- **Performance Thresholds:** Verify API thin-client latency rests below 300ms round trip for standard dashboard loading, contrasting heavy localStorage hydrations.

## 14. Phase 1 Patch Application

To initiate the transformation, the most critical security flaw — the local persistence of plaintext passwords for synchronous verification — was isolated and addressed as an immediate, interim fix. Legacy plaintext entries are hashed dynamically.

```diff
--- a/frontend/src/api/client.ts
+++ b/frontend/src/api/client.ts
@@ -1039,7 +1039,7 @@
       id: 'usr_' + Math.random().toString(36).slice(2, 8),
       email: primaryEmail,
       displayName: data.displayName,
-      password: data.password,
+      passwordHash: hashString(data.password),
       plan: 'Starter',
       accountType: data.accountType,
@@ -1111,9 +1111,19 @@
   async login(email: string, password: string): Promise<{ success: boolean; error?: string; user?: User }> {
     const users = loadUsers();
     const found = findUserByLogin(users, email);
-    if (!found || found.password !== password) {
+    // Support legacy plain text passwords during migration by checking both
+    const hash = hashString(password);
+    const passwordMatch = found && (found.passwordHash === hash || (found as any).password === password);
+    if (!found || !passwordMatch) {
       return { success: false, error: 'Invalid email or password.' };
     }
+
+    // Migrate legacy plaintext passwords to hash on successful login
+    if ((found as any).password) {
+      delete (found as any).password;
+      found.passwordHash = hash;
+      saveUsers(users);
+    }
```
