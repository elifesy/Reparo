# Reparo — Security Posture

This document tracks the security threats identified in the Reparo codebase, which are mitigated, and which are still pending. Update it whenever security-relevant code or configuration changes.

Last reviewed: 2026-04-12

---

## Handled Threats

### Critical

#### 1. Forged JWT tokens via hardcoded secret fallback
- **Threat:** `middleware/auth.js` previously fell back to a hardcoded string if `JWT_SECRET` was unset, allowing an attacker to sign tokens for any user.
- **Mitigation:** `middleware/auth.js` now hard-exits on startup in production if `JWT_SECRET` is not set. In development, an ephemeral random secret is generated per process and a warning is logged (tokens are invalidated on restart, which is acceptable in dev).
- **Operational requirement:** `JWT_SECRET` must be configured in the production environment (e.g. `fly secrets set JWT_SECRET=$(openssl rand -hex 48)`).

#### 2. SQL injection in engineer stats endpoint
- **Threat:** `GET /api/services/stats/overview` interpolated `req.user.id` directly into SQL strings. Although the value came from a verified JWT, it violated prepared-statement discipline and would become exploitable if token validation were ever bypassed.
- **Mitigation:** `routes/services.js` now builds the engineer filter as a `WHERE engineer_id = ?` clause and passes `req.user.id` as a bound parameter to every count query in that route.

#### 3. Privilege escalation on service creation
- **Threat:** `POST /api/services` accepted `engineerId`, `engineerName`, `cost`, `priority`, and `source` from the request body with no authorization check. A Customer could self-assign as engineer, set their own cost to 0, mark tickets as `walk-in`, or boost priority.
- **Mitigation:** `routes/services.js` POST handler inspects `req.user.role`. For non-staff users, `engineerId`/`engineerName` are forced to null/empty, `cost` to 0, `priority` to `Medium`, and `source` to `online`. Customers also cannot pass a `custId` belonging to another user. `priority` and `source` are further validated against enum whitelists for everyone.

### High

#### 4. Cross-origin requests from any origin (CORS wildcard)
- **Threat:** `cors()` was called with default options, allowing any origin to hit the API.
- **Mitigation:** `server.js` configures CORS with an allowlist driven by the `ALLOWED_ORIGINS` environment variable (comma-separated). Requests without an `Origin` header (curl, same-origin, server-to-server) are permitted; any other origin not in the allowlist is rejected.
- **Operational requirement:** Set `ALLOWED_ORIGINS` to the real production domain(s) before shipping.

#### 5. Missing HTTP security headers
- **Threat:** No CSP, HSTS, X-Frame-Options, X-Content-Type-Options, or Referrer-Policy — exposing users to XSS, clickjacking, MIME sniffing, and protocol downgrade.
- **Mitigation:** `server.js` installs a middleware that sets:
  - `Content-Security-Policy: default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`
  - `X-Frame-Options: DENY`
  - `X-Content-Type-Options: nosniff`
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - `Permissions-Policy: geolocation=(), microphone=(), camera=()`
  - `Strict-Transport-Security: max-age=31536000; includeSubDomains` (production only)
  - `X-XSS-Protection: 0` (legacy header explicitly disabled per current guidance)
- **Note:** `'unsafe-inline'` is currently permitted for both `style-src` and `script-src` because the bundled SPA in `public/index.html` uses inline `style="..."` attributes and inline `onclick="..."` event handlers throughout. Removing either requires refactoring the SPA — see Pending Threat #5.

#### 6. Brute-force on login/register
- **Threat:** No rate limit on authentication endpoints.
- **Mitigation:**
  - `routes/auth.js` applies `express-rate-limit` per-route: login = 10 attempts / 15 min / IP, register = 5 / hour / IP.
  - `server.js` also applies a global limiter of 200 requests / minute / IP on `/api/*` as defense in depth.

#### 7. Weak password policy
- **Threat:** Registration only checked `password.length >= 8`.
- **Mitigation:** `routes/auth.js` exposes a `validatePassword()` helper requiring ≥8 chars plus at least one lowercase, one uppercase, and one digit. It is applied in `POST /register` and `PUT /me`. `routes/admin.js` has its own copy (`validatePasswordStrong`) applied in `POST /users` and `PUT /users/:id`.

#### 8. Raw error messages leaked to clients
- **Threat:** `routes/admin.js` previously returned `e.message` to the client in `/test-email` and `/clear-data`, exposing stack-trace–grade internals.
- **Mitigation:** Both handlers now `console.error(e)` server-side and return generic messages (`"Failed to send test email. Check SMTP configuration."` and `"Failed to reset data."`).

#### 9. Hardcoded default password on admin-created users
- **Threat:** `POST /api/users` fell back to `'TempPass1!'` when no password was provided, so any admin creating users without specifying one produced accounts with the same known password.
- **Mitigation:** `routes/admin.js` now rejects user creation when `password` is missing and runs the password through `validatePasswordStrong()`.

#### 10. No HTTPS enforcement in production
- **Threat:** The server accepted plain HTTP, enabling token theft via MITM.
- **Mitigation:** `server.js` redirects non-HTTPS requests to HTTPS in production (using `req.secure` or `X-Forwarded-Proto` when behind a proxy). `app.set('trust proxy', 1)` is set so the header is honored. HSTS is sent as a secondary defense.

#### 11. No CSRF / cross-origin write protection
- **Threat:** No explicit CSRF tokens on state-changing operations.
- **Mitigation:** Reparo uses `Authorization: Bearer` JWTs rather than cookies, so classical form-based CSRF does not apply (browsers do not auto-attach bearer headers). The CORS allowlist and `frame-ancestors 'none'` CSP directive further constrain cross-origin script access. No additional CSRF token is needed under the current auth model, but this must be revisited if session cookies are introduced.

### Medium

#### 12. Demo credentials printed to logs
- **Threat:** `server.js` unconditionally logged demo Admin/Engineer/Customer credentials at startup, which would leak into shared container logs in production.
- **Mitigation:** The credentials block is now gated on `NODE_ENV !== 'production'`.

#### 13. Settings endpoint accepted arbitrary keys (stored-XSS vector)
- **Threat:** `PUT /api/settings` performed an unconditional upsert of every key/value in the request body. An admin (or anyone who compromised an admin session) could write arbitrary keys with HTML payloads that then rendered in the SPA's branding surface.
- **Mitigation:** `routes/admin.js` defines `ALLOWED_SETTING_KEYS` and rejects any key not in the whitelist. Values are capped at 5000 characters.

#### 14. Unescaped interpolation in email templates (stored XSS → email client)
- **Threat:** `utils/mailer.js` interpolated `portalName`, `custName`, `device`, `phone`, and `supportEmail` directly into the HTML email template. A malicious customer name or a poisoned settings value would execute in the recipient's mail client.
- **Mitigation:** Added `esc()` (HTML entity escape) and `escAttr()` (adds `javascript:`/`data:`/`vbscript:` scheme stripping for href attributes). All interpolations in `buildHtml()` and in `sendTestEmail()` now pass through `esc()`.

#### 15. Unbounded list endpoints (DoS / bulk exfiltration)
- **Threat:** `GET /api/services` defaulted to `limit=200` with no enforced maximum. `GET /api/audit` ignored pagination entirely.
- **Mitigation:**
  - `routes/services.js` clamps `limit` to `[1, 200]` and `offset` to `≥ 0`.
  - `routes/admin.js` `GET /audit` clamps `limit` to `[1, 1000]`, supports `offset`, and returns `{ rows, total, limit, offset }`.

#### 16. Unvalidated role / status on user mutation
- **Threat:** Admin user create/update accepted arbitrary strings for `role` and `status`, allowing the creation of users with undefined states that bypass downstream role checks.
- **Mitigation:** `routes/admin.js` whitelists `ALLOWED_ROLES = ['Admin','Engineer','Customer']` and `ALLOWED_STATUS = ['Active','Inactive','On Leave']`. Both create and update handlers reject unknown values.

#### 17. Missing email format validation
- **Threat:** Registration and admin user-create accepted any string as `email`.
- **Mitigation:** Both routes now validate against `/^[^\s@]+@[^\s@]+\.[^\s@]+$/`.

#### 18. Oversized request bodies
- **Threat:** `express.json()` used the default 100kb-ish limit and was not strict; large payloads could be used for resource exhaustion.
- **Mitigation:** `server.js` uses `express.json({ limit: '100kb', strict: true })`. The global API rate limiter further caps request volume.

### Low

#### 19. Framework fingerprinting via `X-Powered-By`
- **Mitigation:** `app.disable('x-powered-by')` in `server.js`.

#### 20. SQLite file world-readable
- **Mitigation:** `db/setup.js` runs `fs.chmodSync(DB_PATH, 0o600)` on startup (best-effort; ignored on filesystems that do not support Unix permissions, e.g. Windows dev boxes, some mounted volumes).

---

## Pending Threats

These cannot be fixed without input or a decision from the project owner.

### 1. Production JWT secret not yet provisioned
- **Status:** Code enforces the requirement; the actual secret must be set in the Fly.io environment.
- **Action:** `fly secrets set JWT_SECRET=$(openssl rand -hex 48)`
- **Severity if ignored:** The server will refuse to start in production (fail-closed), so this is safe but must be done before deploy.

### 2. CORS allowlist not yet populated
- **Status:** `server.js` reads from the `ALLOWED_ORIGINS` env var; if unset in production, the allowlist is empty and all cross-origin requests will be rejected (which is safe but may break a browser client on a different domain).
- **Action:** `fly secrets set ALLOWED_ORIGINS="https://app.example.com,https://admin.example.com"`

### 3. PII stored in plaintext (`cust_phone`, `cust_email`, `serial`, `imei`)
- **Status:** Unresolved. Requires a key-management decision and a data migration for existing rows.
- **Proposed approach:** Field-level AES-256-GCM encryption with the key provided via env var, wrapped behind a helper in `db/setup.js`. Migration script must re-encrypt all existing rows in a single transaction.
- **Severity:** Medium — relevant if the SQLite file or a backup is ever exfiltrated.

### 4. Default seeded passwords (`Admin1234!`, `Eng1234!`, `Demo1234!`)
- **Status:** Still present in `db/setup.js` seed block. Safe for development; dangerous if the database is ever seeded in production.
- **Action:** Either (a) skip seeding entirely when `NODE_ENV === 'production'`, or (b) require seed passwords to be provided via environment variables. Decision needed.

### 5. CSP `'unsafe-inline'` for scripts and styles
- **Status:** Currently permitted for both `script-src` and `style-src` because `public/index.html` relies on inline `onclick="..."` handlers and inline `style="..."` attributes throughout. Without `'unsafe-inline'` in `script-src`, every button in the SPA is silently blocked by the browser.
- **Action:** Refactor the SPA to attach event handlers via `addEventListener` (or delegated listeners) and move inline styles to a stylesheet; then drop `'unsafe-inline'` from both directives in `server.js`. Alternatively, adopt a nonce-based CSP — the middleware would generate a per-request nonce and the template would stamp it onto every `<script>` tag.
- **Severity:** Medium — the current policy still blocks loading scripts/styles from any external origin, so the main XSS vectors closed are data exfiltration to attacker domains and injection of external script URLs.

### 6. No 2FA for admin accounts
- **Status:** The `sec_2fa` setting exists but is not wired to any code path.
- **Action:** Implement TOTP enrolment and a second-factor check in `POST /api/auth/login` for Admin/Engineer roles. Requires a product decision about enrolment UX and recovery codes.

### 7. No centralized request/security event logging
- **Status:** `audit_log` captures a subset of actions but there is no per-request access log or SIEM integration.
- **Action:** Decide whether to ship logs to an external system (e.g. Fly log drain → Logtail/Datadog) and add a request logger middleware.

### 8. No automated dependency scanning in CI
- **Status:** `package.json` is not scanned on each push.
- **Action:** Add `npm audit --audit-level=high` (or Dependabot / Snyk) to the GitHub Actions workflow.

### 9. No backup encryption for SQLite file
- **Status:** The Fly volume at `/data/reparo.sqlite` is not encrypted at rest by Reparo (only by the underlying host, if at all).
- **Action:** Decide between (a) relying on provider-level encryption, (b) field-level encryption (see item 3), or (c) encrypted snapshots uploaded to object storage.

---

## Change Log

| Date       | Change                                                                 |
|------------|------------------------------------------------------------------------|
| 2026-04-12 | Initial security audit; items 1–20 mitigated, items 1–9 pending listed. |
