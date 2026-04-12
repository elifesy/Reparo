# Reparo — Device Service Management Portal

## Requirements
- Node.js 18+ (https://nodejs.org)
- npm (comes with Node.js)
- [flyctl](https://fly.io/docs/hands-on/install-flyctl/) (for deployment)

## Quick Start

```bash
# 1. Install dependencies (first time only)
npm install

# 2. Start the server
npm start

# 3. Open in browser
http://localhost:3000
```

## Demo Credentials

| Portal   | Email                  | Password   |
|----------|------------------------|------------|
| Admin    | admin@reparo.com       | Admin1234! |
| Engineer | m.alfarsi@reparo.com   | Eng1234!   |
| Customer | demo@reparo.com        | Demo1234!  |

## Project Structure

```
reparo/
├── server.js                  ← Express app entry point
├── package.json               ← Dependencies & npm scripts
├── fly.toml                   ← Fly.io deployment config
├── Dockerfile                 ← Production container
├── scripts/
│   ├── deploy.sh              ← Full deploy pipeline (pre + fly + post)
│   ├── predeploy.sh           ← Pre-deploy checks (syntax, deps, smoke test)
│   └── postdeploy.sh          ← Post-deploy verification (machine, HTTP, logs)
├── db/
│   ├── setup.js               ← SQLite schema, default settings, seed data
│   └── reparo.sqlite          ← Auto-created on first run (local only)
├── middleware/
│   └── auth.js                ← JWT auth middleware
├── routes/
│   ├── auth.js                ← Login, register, profile
│   ├── services.js            ← Full service CRUD + public tracking
│   ├── admin.js               ← Users, announcements, settings, audit, branding
│   └── seedHelper.js          ← Seed function used by setup.js and clear-data reset
├── utils/
│   └── mailer.js              ← Nodemailer SMTP + status notification emails
├── .claude/
│   └── settings.json          ← Claude Code hooks (auto pre-deploy checks)
└── public/
    ├── index.html             ← Full frontend SPA
    └── kids-game.html         ← Animal sounds game
```

## API Reference

### Auth — `/api/auth`
| Method | Endpoint           | Description           | Auth     |
|--------|--------------------|-----------------------|----------|
| POST   | /login             | Login → JWT token     | Public   |
| POST   | /register          | Register as customer  | Public   |
| GET    | /me                | Get own profile       | Any role |
| PUT    | /me                | Update own profile    | Any role |

### Services — `/api/services`
| Method | Endpoint              | Description                        | Auth           |
|--------|-----------------------|------------------------------------|----------------|
| GET    | /                     | List (scoped by role)              | Any role       |
| GET    | /:id                  | Get single service + activities    | Any role       |
| GET    | /track/:id            | Public status tracking by ID       | Public         |
| GET    | /track/search?q=      | Search by ID, phone, or email      | Public         |
| GET    | /stats/overview       | Counts, revenue, charts            | Engineer/Admin |
| POST   | /                     | Create service request             | Any role       |
| PATCH  | /:id                  | Update status/cost/engineer/notes  | Engineer/Admin |
| DELETE | /:id                  | Delete service                     | Admin          |

### Admin — `/api`
| Method | Endpoint                  | Description                        | Auth   |
|--------|---------------------------|------------------------------------|--------|
| GET    | /branding                 | Public branding (logo, name)       | Public |
| GET    | /users                    | List users (filter/search)         | Admin  |
| POST   | /users                    | Create user                        | Admin  |
| PUT    | /users/:id                | Update user                        | Admin  |
| DELETE | /users/:id                | Delete user                        | Admin  |
| PATCH  | /users/:id/status         | Toggle Active/Inactive             | Admin  |
| GET    | /announcements            | List announcements                 | Public |
| POST   | /announcements            | Create announcement                | Admin  |
| PATCH  | /announcements/:id        | Toggle active flag                 | Admin  |
| DELETE | /announcements/:id        | Delete announcement                | Admin  |
| GET    | /settings                 | Get all settings (key/value)       | Admin  |
| PUT    | /settings                 | Upsert settings                    | Admin  |
| GET    | /audit                    | Audit log (last 100 entries)       | Admin  |
| GET    | /storage-stats            | Row counts + DB file size          | Admin  |
| POST   | /test-email               | Send SMTP test email               | Admin  |
| POST   | /clear-data               | Wipe all data and re-seed          | Admin  |

## Deployment

### Safe deploy (recommended)

```bash
./scripts/deploy.sh
# or
npm run deploy
```

This runs three stages automatically:

#### Stage 1 — Pre-deploy checks (`scripts/predeploy.sh`)
1. **Syntax check** — `node --check` on every `.js` file; blocks deploy on any `SyntaxError`
2. **Dependency audit** — every `require()` call is matched against `package.json` dependencies; blocks deploy if a package is missing
3. **Smoke test** — boots the server locally and hits `/api/health`; skipped automatically if native modules can't compile on the local Node version (Docker handles it)

#### Stage 2 — Fly.io deploy
```bash
fly deploy --app reparo-app
```

#### Stage 3 — Post-deploy verification (`scripts/postdeploy.sh`)
4. **Machine state** — polls until the Fly machine reaches `started`; fails if it stops
5. **HTTP health check** — curls `https://reparo-app.fly.dev/api/health` and expects HTTP 200
6. **Log crash scan** — tails recent logs and fails if `SyntaxError`, `MODULE_NOT_FOUND`, or other crash patterns appear

### Claude Code hook

`.claude/settings.json` registers a `PreToolUse` hook that runs `predeploy.sh` automatically before any `fly deploy` command executed by Claude Code — no manual step needed.

### Manual deploy (skip checks — not recommended)
```bash
fly deploy --app reparo-app
```

### Recovering a suspended machine

If the Fly machine enters a crash loop and gets suspended:

```bash
# 1. Destroy the suspended machine
fly machine destroy <machine-id> --app reparo-app --force

# 2. Re-deploy (creates a fresh machine)
./scripts/deploy.sh
```

### Connecting to the live database
```bash
fly ssh console --app reparo-app
sqlite3 /data/reparo.sqlite
```

## Environment Variables

| Variable     | Default              | Notes                              |
|--------------|----------------------|------------------------------------|
| `PORT`       | `3000`               | HTTP port                          |
| `JWT_SECRET` | `reparo-dev-secret`  | **Change this in production**      |
| `NODE_ENV`   | —                    | Set to `production` on Fly         |

Generate a strong secret:
```bash
fly secrets set JWT_SECRET=$(openssl rand -base64 32) --app reparo-app
```

## Branding

Admins can customise the portal from **Admin → Settings → Branding**:

- **Portal Name** — used in emails, footer, and page title
- **Nav Bar Text** — overrides the name shown in the top-left logo area; leave blank to use Portal Name
- **Logo Image** — upload any image; stored as base64 in the database; replaces the default ⚡ icon immediately
- Changes apply live without a page reload and persist across restarts

## Email Notifications

Configure SMTP under **Admin → Settings → Email & Notifications**:

| Setting               | Description                                      |
|-----------------------|--------------------------------------------------|
| SMTP Host / Port      | e.g. `smtp.gmail.com` / `587`                   |
| SMTP User / Password  | Authentication credentials                       |
| From Name / Email     | Displayed sender in customer emails              |
| Notify on statuses    | JSON array, e.g. `["Diagnosed","Ready"]`        |
| Enable notifications  | Master on/off toggle                             |

Use **Send Test Email** to verify SMTP before enabling live notifications.

## Database

SQLite is stored at:
- **Local:** `db/reparo.sqlite`
- **Production:** `/data/reparo.sqlite` (Fly persistent volume)

Reset to factory defaults (local):
```bash
rm db/reparo.sqlite && npm start
```

Reset via Admin UI: **Admin → Settings → Data & Storage → Reset All Data to Factory Defaults**

## Common Issues

| Symptom | Cause | Fix |
|---------|-------|-----|
| App crashes on startup | `SyntaxError` in a JS file | Run `node --check routes/*.js utils/*.js` |
| `MODULE_NOT_FOUND` on startup | Package not in `dependencies` | `npm install <pkg> --save` |
| Fly machine suspended | Repeated crash loop | Destroy machine, fix the bug, re-deploy |
| Native module error locally | Node version mismatch | Smoke test is skipped; Docker build verifies |
