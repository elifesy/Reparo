# Reparo — Changelog

---

## v2.0.0 — Deployment Pipeline & Branding Controls
- Added `scripts/predeploy.sh` — syntax-checks all JS files, audits every `require()` against `package.json` dependencies, attempts local startup smoke test
- Added `scripts/postdeploy.sh` — verifies machine state, HTTP 200 on live URL, scans logs for crash patterns
- Added `scripts/deploy.sh` — single command runs all checks then deploys
- Wired `npm run deploy` and `npm run predeploy` into `package.json`
- Added `.claude/settings.json` hook — pre-deploy checks run automatically before every `fly deploy` command
- Restored Admin → Branding: logo image upload (base64, persisted in DB), nav bar text override, live preview
- Added public `GET /api/branding` endpoint — branding applies to nav before login
- Added `portal_logo`, `nav_brand_text`, and all SMTP keys to default settings in `db/setup.js`

---

## v1.9.0 — Deployment Fix & Email Notifications
- Fixed `nodemailer` missing from production `dependencies` in `package.json` — app was crashing on startup
- Fixed escaped template literal in `routes/services.js` that caused `SyntaxError` on deploy
- Extracted seed logic into `routes/seedHelper.js` — `POST /clear-data` now correctly re-seeds after reset
- Re-wired `sendStatusNotification` in `routes/services.js` — customer email alerts fire on status changes
- Replaced suspended Fly.io machine with a fresh one to recover from crash loop

---

## v1.8.0 — Clean Login Screen
- Removed all demo login buttons and credentials hints from all three portals (Customer, Engineer, Admin)
- Removed demo 2FA code hint from Admin login
- Removed `Ctrl+Shift+D` reveal shortcut
- Login screen is now production-ready with no demo artefacts

## v1.7.0 — Full Data Reset
- **Clear All Data & Reset to Defaults** replaces the old "Clear Demo Data" button
- Deletes everything — all users (including admin), services, activity logs, announcements, audit log, and custom branding/SMTP settings
- Immediately re-seeds the database to factory defaults without requiring a server restart
- Admin is signed out automatically after reset
- Added `sqlite3` to the Docker image — live database queries now work via `flyctl ssh console`

---

## v1.6.2 — Nav Branding Control
- Admin can set a custom **Nav Bar Text** independently from the Portal Name
- Toggle to **show or hide** the name beside the logo (logo-only mode)
- Both settings persist in the database and apply instantly on save

## v1.6.1 — Logo & Branding
- Admin can upload a custom logo (PNG, JPG, SVG — max 500 KB)
- Logo previewed instantly before saving
- Logo stored as base64 in the database — survives deployments
- Nav bar logo and name update live on save without a page reload
- Portal name change reflects in the nav bar

## v1.6.0 — Admin Service Creation
- Admin can create service requests directly from the admin panel
- "New Service" entry added to the admin sidebar
- "New Service" shortcut button added to the All Services header
- Full intake form: customer info, device details, issue category, priority, conditions checklist, logistics, engineer assignment, and source (walk-in / phone / online / referral)
- On submit, navigates back to the All Services list automatically

---

## v1.5.0 — UX Improvements
- **Demo login buttons** hidden by default — revealed with `Ctrl+Shift+D` (toggles on/off)
- **"Track My Repair"** redesigned as a full-width accent-bordered button with subtitle "No Login Needed"
- **SMS / WhatsApp / Daily Digest** notification toggles marked **Coming Soon** and disabled — no backend exists for these channels
- Fake SMS toast removed from the engineer intake flow

---

## v1.4.0 — Email Notifications
- Admin configures SMTP server (host, port, username, password, from name, from email, SSL/TLS toggle)
- Global enable/disable toggle for customer email notifications
- Per-status checkboxes — admin selects which statuses trigger an email (fully flexible, no code changes needed if the status list changes)
- Professional HTML email template with branded header, status card, service info table, and CTA buttons
- **Send Test Email** button to verify SMTP configuration before going live
- In-app DNS and hosting guide covering SPF, DKIM, and DMARC setup
- Email fires automatically and non-blocking when an engineer or admin changes a service status

---

## v1.3.0 — Demo Data Management
- Admin **Danger Zone** in Settings — clears all demo data (services, customers, engineers, announcements, audit log) while preserving the admin account
- Confirmation dialog before clearing
- Action logged to the audit trail

---

## v1.2.0 — Theming
- 5 selectable UI themes (Dark, Light, Sand, Ocean, Forest)
- Theme persisted across sessions via localStorage
- Theme panel accessible from the top nav

---

## v1.0.0 — Initial Release
- **Customer portal** — submit service requests, track status, view activity timeline
- **Engineer portal** — manage assigned jobs, update status, walk-in intake form, checklist
- **Admin portal** — full dashboard with stats, analytics, user management, engineer workload, announcements, audit log, and system settings
- JWT authentication with role-based access control (Admin / Engineer / Customer)
- SQLite database via better-sqlite3 with WAL mode
- Demo seed data — users, services, and announcements pre-loaded on first run
- Deployed to Fly.io with persistent volume for SQLite
