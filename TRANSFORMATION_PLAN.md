# VelisMail System Transformation & Upgrade Plan

## 1. Current System Classification
- **Classification:** MVP transitioning to Production-Ready Microservice Architecture.
- **Analysis:** The system features a strong, distributed backend built in Rust using Axum and `sqlx`, separated into domain-specific microservices (api-gateway, auth-service, mail-service, storage-service, tenant-service, delivery-engine). The frontend is a React Single Page Application (SPA) utilizing Zustand for state management and Vite for tooling.
- **State:** While the infrastructure foundation (Docker Compose, NATS, Redis, Postgres, MinIO) is robust, parts of the implementation remain incomplete. The frontend still heavily relies on `localStorage` for API data that should be fetched from the backend (e.g., contacts, domains, emails), and critical security components like WebAuthn/Passkeys are only partially implemented (stubbed). The UI design lacks the premium, polished feel required for an enterprise-grade secure mail client.

## 2. Critical Weaknesses
- **Architecture:** The frontend API client is a "mock" client relying on local storage, breaking the true client-server contract and rendering the robust backend microservices partially unused by the UI.
- **Security:**
  - Passkey flows are stubbed and incomplete.
  - Rate limiting needs to be stricter on public endpoints.
  - Cross-Origin Resource Sharing (CORS) configurations need tightening.
  - JWT rotation (refresh tokens) is not fully enforced or implemented robustly on the client.
- **UX/UI:** The design contains remnants of standard/generic component libraries, lacks a true premium "Soft Dark" theme, and included explicitly forbidden colors (blue, green) which have now been removed.
- **Performance:** Zustand stores in the frontend are returning entire state objects instead of using stable selectors, causing unnecessary React re-renders. Backend `COUNT(*)` queries may fail serialization if not cast correctly due to `sqlx` mapping `COUNT` to `i64`.

## 3. What Must Be Removed
- **What:** The `localStorage`-based frontend API client (`frontend/src/api/client.ts`).
- **Why:** It completely bypasses the backend microservices, causing data silos and security risks.
- **What:** All dummy data generation and stubbed test files.
- **Why:** Clutters the codebase, confuses developers, and risks leaking into production.
- **What:** Any remaining traces of "Blue" or "Green" from the color palette.
- **Why:** Violates explicit design requirements for the premium soft dark theme.

## 4. What Must Be Redesigned
- **What:** Frontend State Management (Zustand).
- **Why:** Returning full state objects causes infinite loop risks and poor performance.
- **Upgrade:** Refactor Zustand hooks to use granular, stable selectors.
- **What:** API Gateway routing and Middleware.
- **Why:** Needs stricter validation and tighter integration with the auth service for true request validation rather than passing through unverified tokens.
- **Upgrade:** Enhance the `authentication` middleware in the API gateway to fully decode and validate JWTs before proxying.

## 5. What Must Be Added
- **What:** Full WebAuthn / Passkey Implementation.
- **Why:** Crucial for the "Zero-Knowledge" and high-security branding of the product.
- **Upgrade:** Complete the ZKP and WebAuthn flows on both the frontend and the `auth-service`.
- **What:** Comprehensive Audit Logging.
- **Why:** Enterprise business accounts require detailed logs of access and changes.
- **Upgrade:** Implement a robust event logging system in the backend, viewable in the frontend settings.

## 6. Security Hardening Plan
- **Authentication:** Finalize passkey/WebAuthn. Enforce strict JWT refresh token rotation.
- **Authorization:** Ensure all intra-service calls pass the `tenant_id` to prevent cross-tenant data leakage. Implement strict Role-Based Access Control (RBAC) checks on admin endpoints.
- **Headers & CORS:** Enforce strict CORS validating against `FRONTEND_URL`. Add `Content-Security-Policy` (CSP) to the API Gateway's security headers.
- **Rate Limiting:** Implement route-specific rate limiting (e.g., stricter limits on `/login` and `/device/register` compared to `/me`).

## 7. Feature Expansion Plan
- **Advanced Search:** Integrate an indexing service (like Elasticsearch or a dedicated Postgres FTS schema) to enable fast, full-text search across emails.
- **Webhook Delivery Notifications:** Allow business accounts to register webhooks to receive real-time notifications of email delivery statuses (bounced, delivered, opened).
- **Admin Dashboard:** Build a super-admin view for managing tenants, global settings, and viewing system health metrics.

## 8. UX/UI Redesign Plan
- **Theme:** Establish a strict Premium Soft Dark theme (Monochrome, Graphite, Charcoal).
- **Components:** Polish buttons, inputs, and cards to have subtle glassmorphism effects (already partially present, but needs refinement).
- **Interactions:** Add smooth micro-interactions for button hovers, loading states, and page transitions.
- **Accessibility:** Ensure high contrast text, proper ARIA labels, and keyboard navigation support throughout the SPA.

## 9. Performance and Scalability Plan
- **Frontend:** Implement code splitting based on routes and heavy vendor dependencies (already started in Vite config, needs tuning).
- **Backend:** Optimize database connection pools for `sqlx`. Implement Redis caching for frequently accessed, slow-changing data (like user profiles or tenant configurations).
- **Query Optimization:** Ensure all analytical or aggregate queries (`COUNT`) are properly cast to `u32` for struct compatibility, and use indexes efficiently.

## 10. Code Quality and Maintainability Plan
- **Linting:** Enforce strict Rust clippy rules (`-D warnings`) in CI.
- **Typing:** Maximize strict TypeScript usage in the frontend; eliminate `any` types.
- **Modularity:** Ensure clear boundaries between the frontend API service layer and React components.
- **Clean Up:** Aggressively remove unused imports, dead code, and temporary hacks.

## 11. Versioned Roadmap

### Version 1: Immediate Critical Fixes
- **Scope:** Remove forbidden colors (completed), fix Zustand selectors, clean up Rust warnings.
- **Why:** Prevents UI bugs, performance issues, and CI failures.
- **Risk:** Low.
- **Impact:** Stabilizes the application and aligns with initial user constraints.

### Version 2: Backend Integration & Security Hardening
- **Scope:** Replace local storage API client with real `fetch` calls to backend. Complete Passkey/WebAuthn flows. Implement JWT refresh rotation.
- **Why:** Realizes the value of the microservice architecture and secures the platform.
- **Risk:** High (rewriting API layer).
- **Impact:** Transforms the app from a prototype to a functional, secure application.

### Version 3: Enterprise Features & Polish
- **Scope:** Add Audit Logs, Webhooks, Advanced Search, and refine the UX/UI micro-interactions.
- **Why:** Makes the product competitive for enterprise users.
- **Risk:** Medium.
- **Impact:** Significantly increases product value and user retention.

### Version 4: Scaling & Advanced Tech
- **Scope:** Multi-region deployments, AI-assisted workflows, advanced threat detection.
- **Why:** Future-proofs the system and adds cutting-edge capabilities.
- **Risk:** High.
- **Impact:** Establishes VelisMail as a market leader in secure communication.

## 12. Step-by-Step Transformation Sequence (For Version 2 Execution)
1. **Frontend API Refactor:** Modify `frontend/src/api/client.ts` to use `fetch` with the `VITE_API_URL`. Ensure JWT tokens are attached to requests.
2. **Backend Gateway Setup:** Ensure `API Gateway` correctly routes incoming requests from the new frontend client, validating CORS against `FRONTEND_URL`.
3. **Passkey Implementation:** Replace stubs in `services/auth-service/src/passkey.rs` with real WebAuthn logic. Update frontend components to handle the WebAuthn challenge/response.
4. **Data Leakage Prevention:** Review all database queries in `mail-service` and `tenant-service` to ensure `WHERE tenant_id = $1` is strictly applied.

## 13. Validation and Benchmark Plan
- **Unit Testing:** Write frontend unit tests using Vitest for API client changes. Add backend tests for Passkey flows.
- **Integration Testing:** Run the full stack via Docker Compose and use Playwright for end-to-end user flows (login, send email).
- **Linting:** Run `cargo clippy --workspace --all-targets --all-features -- -D warnings` and `npm run lint`.
- **Manual Verification:** Build the frontend and deploy locally; verify the theme has no green/blue and that network requests reach the backend.

## 14. Concrete Patches Executed
- Modified `frontend/src/pages/Settings.tsx` to remove "Blue", "Indigo", and "Emerald" theme options.
- Modified `frontend/index.html` to update the meta `theme-color` from `#10b981` (emerald) to `#121212` (dark theme).
