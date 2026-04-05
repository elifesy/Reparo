# Reparo — Setup Guide

## Requirements
- Node.js 18+ (https://nodejs.org)
- npm (comes with Node.js)

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

| Portal   | Email                       | Password     |
|----------|-----------------------------|--------------|
| Admin    | admin@reparo.com          | Admin1234!   |
| Engineer | m.alfarsi@reparo.com      | Eng1234!     |
| Customer | demo@reparo.com           | Demo1234!    |

Admin 2FA code (demo): **123456**

## Project Structure

```
reparo/
├── server.js              ← Express app entry point
├── package.json           ← Dependencies
├── db/
│   ├── setup.js           ← SQLite schema + seed data
│   └── reparo.sqlite    ← Auto-created on first run
├── middleware/
│   └── auth.js            ← JWT auth middleware
├── routes/
│   ├── auth.js            ← Login, register, profile
│   ├── services.js        ← Full service CRUD
│   └── admin.js           ← Users, announcements, settings, audit
└── public/
    └── index.html         ← Frontend (served by Express)
```

## API Endpoints

### Auth
| Method | Endpoint         | Description              | Auth       |
|--------|-----------------|--------------------------|------------|
| POST   | /api/auth/login  | Login (returns JWT)      | Public     |
| POST   | /api/auth/register | Register customer      | Public     |
| GET    | /api/auth/me     | Get current user         | Any role   |
| PUT    | /api/auth/me     | Update profile           | Any role   |

### Services
| Method | Endpoint                   | Description              | Auth            |
|--------|---------------------------|--------------------------|-----------------|
| GET    | /api/services              | List (filtered by role)  | Any role        |
| GET    | /api/services/:id          | Get single service       | Any role        |
| GET    | /api/services/track/:id    | Public tracking          | Public          |
| POST   | /api/services              | Create service           | Any role        |
| PATCH  | /api/services/:id          | Update service           | Engineer/Admin  |
| DELETE | /api/services/:id          | Delete service           | Admin only      |
| GET    | /api/services/stats/overview | Stats & charts         | Engineer/Admin  |

### Admin
| Method | Endpoint                   | Description              | Auth       |
|--------|---------------------------|--------------------------|------------|
| GET    | /api/users                 | List users               | Admin      |
| POST   | /api/users                 | Create user              | Admin      |
| PUT    | /api/users/:id             | Update user              | Admin      |
| DELETE | /api/users/:id             | Delete user              | Admin      |
| PATCH  | /api/users/:id/status      | Toggle active/inactive   | Admin      |
| GET    | /api/announcements         | List announcements       | Public     |
| POST   | /api/announcements         | Create announcement      | Admin      |
| PATCH  | /api/announcements/:id     | Toggle active            | Admin      |
| DELETE | /api/announcements/:id     | Delete                   | Admin      |
| GET    | /api/settings              | Get all settings         | Admin      |
| PUT    | /api/settings              | Update settings          | Admin      |
| GET    | /api/audit                 | Audit log (last 100)     | Admin      |

## Database

SQLite file is created at `./db/reparo.sqlite` on first run.

### To reset to factory data:
```bash
rm db/reparo.sqlite
npm start   # re-seeds automatically
```

### To upgrade to PostgreSQL later:
Replace `better-sqlite3` with `pg` and update the query syntax in `db/setup.js`
and the route files. The schema is standard SQL and transfers directly.

## Environment Variables (optional)

```bash
PORT=3000                          # Default: 3000
JWT_SECRET=your_strong_secret      # Default: dev secret (CHANGE IN PRODUCTION!)
```

For production, set a real JWT_SECRET:
```bash
JWT_SECRET=$(openssl rand -base64 32) npm start
```
