# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm start              # run the server on :3000 (production mode)
npm run dev            # same, with nodemon auto-reload
npm run predeploy      # syntax + dependency + smoke-test gate (scripts/predeploy.sh)
npm run deploy         # full pipeline: predeploy → fly deploy → postdeploy verification
node --check <file.js> # syntax-check a single file (no test framework is installed)
rm db/reparo.sqlite && npm start   # reset local DB to seeded factory state
```

There is **no test framework, linter, or build step**. "Tests" in this codebase mean the smoke test inside `scripts/predeploy.sh` (boots the server, hits `/api/health`) plus the post-deploy log scan. Do not add a `test` script or CI runner without discussing it first.

## Architecture

Single-process Node/Express app serving a **SQLite-backed JSON API plus a static SPA** from the same origin. The SPA lives entirely in `public/index.html` — there is no frontend build, no bundler, no framework. Any changes you make to routes are consumed by that single HTML file via `fetch` calls to `/api/*`.

### Request flow
`server.js` wires everything: security middleware → CORS allowlist → JSON body cap → global rate limiter (`/api`) → static files → route mounts → SPA catch-all. Route mounts are the only place new endpoints should be added:

- `/api/auth`     → `routes/auth.js`      (login, register, profile)
- `/api/services` → `routes/services.js`  (service CRUD, public tracking, stats)
- `/api`          → `routes/admin.js`     (users, announcements, settings, audit, branding, test-email, clear-data)

### Auth model
JWT bearer tokens issued by `routes/auth.js`, verified by `middleware/auth.js`'s `auth([roles])` factory. Three roles: `Admin`, `Engineer`, `Customer`. The JWT secret is loaded from `process.env.JWT_SECRET`; in production the process hard-exits if it's missing, in dev it generates an ephemeral random secret per boot (this will invalidate existing tokens on every restart — expected).

Role-scoped behavior is enforced **inside each handler**, not via middleware — e.g. `GET /api/services` filters by `cust_id` when `req.user.role === 'Customer'`, and `POST /api/services` forcibly resets `engineerId`/`cost`/`priority`/`source` for non-staff callers. When adding new write endpoints, follow this pattern: validate role, whitelist enum fields, never trust client-provided owner IDs.

### Database
`db/setup.js` is loaded as a singleton (`require('../db/setup')` returns the `better-sqlite3` instance). It creates the schema, inserts default settings, and on an empty DB runs the seed block inline. The seed is also re-runnable via `routes/seedHelper.js`, which is called from `POST /api/clear-data`. Schema is in `db/setup.js` — there are no migrations; schema changes must be backwards-compatible or require a manual DB wipe.

Storage paths:
- Local dev: `db/reparo.sqlite` (next to `setup.js`)
- Production: `/data/reparo.sqlite` (Fly persistent volume, mounted per `fly.toml`)

All queries use `better-sqlite3` prepared statements. **Never interpolate user input into SQL strings** — pass as bound parameters. The stats endpoint in `routes/services.js` uses string concatenation only for whitelisted `WHERE`/`AND` keywords, with the actual `engineer_id` value passed as a `?` placeholder.

### Settings / branding / email
`settings` is a key-value table read by `routes/admin.js` and `utils/mailer.js`. `PUT /api/settings` enforces a key whitelist (`ALLOWED_SETTING_KEYS` in `routes/admin.js`) — adding a new runtime setting requires updating that whitelist. `utils/mailer.js` reads SMTP config from this table at send-time (no transporter is cached), and all user-supplied fields in the HTML email template are HTML-escaped via `esc()`.

### Public tracking endpoints
`GET /api/services/track/:id` and `/track/search` are the only unauthenticated service endpoints. They are rate-limited (`trackLimiter` in `routes/services.js`), require phone-last-4 or full email as `verify`, return blind 404s on failure, and strip `cost`/`notes`/`cust_phone` from responses. Don't expose any additional fields in `PUBLIC_COLS` without thinking through the privacy impact.

### Deployment (Fly.io)
`scripts/deploy.sh` runs `predeploy.sh` → `fly deploy` → `postdeploy.sh`. `.claude/settings.json` registers a `PreToolUse` hook that automatically runs `predeploy.sh` whenever Claude Code tries to execute `fly deploy` via Bash, so the gate can't be skipped by accident. If predeploy blocks, fix the underlying issue — don't bypass it.

Recovering from a Fly crash loop: destroy the suspended machine (`fly machine destroy <id> --force`) then re-run `./scripts/deploy.sh`. Never `fly deploy` directly onto a suspended machine.

### Security posture
`SECURITY.md` tracks the authoritative list of handled and pending security threats. **When making changes to auth, routes, settings, SQL, or the email template, cross-reference `SECURITY.md`** — either confirm you haven't regressed a handled item or update the "Pending" section if you're introducing a new gap. Known pending items (see `SECURITY.md` for details): `JWT_SECRET`/`ALLOWED_ORIGINS` must be set in Fly secrets, seeded demo passwords still ship in `db/setup.js`, PII is stored plaintext, no 2FA, no dependency scanning in CI.
