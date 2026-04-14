// ─────────────────────────────────────────────────────────────────────────────
// ISOLATED FEATURE — Data Purge by Age
// ─────────────────────────────────────────────────────────────────────────────
// Admin-only endpoint that deletes services (and their activity rows) older
// than a caller-supplied number of months. Self-contained: to remove this
// feature, delete this file and the matching `app.use('/api/data-purge', …)`
// line in server.js plus the bracketed block in public/index.html.
// ─────────────────────────────────────────────────────────────────────────────

const express = require('express');
const db      = require('../db/setup');
const { auth } = require('../middleware/auth');

const router = express.Router();

// POST /api/data-purge   body: { months: <integer 1..120> }
// Deletes services whose created_at is older than `months` months ago,
// along with their service_activity rows (FK ON DELETE CASCADE handles the
// children, but we count them first for the response).
router.post('/', auth(['Admin']), (req, res) => {
  const months = Number(req.body?.months);

  // Strict validation — must be a whole number in a sane range
  if (!Number.isInteger(months) || months < 1 || months > 120) {
    return res.status(400).json({ error: 'months must be an integer between 1 and 120' });
  }

  // Preview counts so the response can tell the admin what was actually removed
  const cutoffExpr = `datetime('now', ?)`;        // e.g. datetime('now','-6 months')
  const cutoffArg  = `-${months} months`;

  const svcCountRow = db.prepare(
    `SELECT COUNT(*) AS n FROM services WHERE created_at < ${cutoffExpr}`
  ).get(cutoffArg);
  const actCountRow = db.prepare(
    `SELECT COUNT(*) AS n FROM service_activity
     WHERE service_id IN (SELECT id FROM services WHERE created_at < ${cutoffExpr})`
  ).get(cutoffArg);

  const servicesDeleted   = svcCountRow.n;
  const activitiesDeleted = actCountRow.n;

  // Single transaction: activity rows first, then parents
  const purge = db.transaction(() => {
    db.prepare(
      `DELETE FROM service_activity
       WHERE service_id IN (SELECT id FROM services WHERE created_at < ${cutoffExpr})`
    ).run(cutoffArg);
    db.prepare(
      `DELETE FROM services WHERE created_at < ${cutoffExpr}`
    ).run(cutoffArg);
  });

  try {
    purge();
  } catch (e) {
    console.error('Data purge failed:', e);
    return res.status(500).json({ error: 'Failed to purge old data.' });
  }

  // Audit trail (intentionally verbose — this is a destructive op)
  db.prepare('INSERT INTO audit_log(action,user_email,ip) VALUES(?,?,?)').run(
    `DATA PURGE: removed ${servicesDeleted} services + ${activitiesDeleted} activities older than ${months} month(s)`,
    req.user.email,
    req.ip
  );

  res.json({
    message: `Purged data older than ${months} month(s).`,
    months,
    servicesDeleted,
    activitiesDeleted,
  });
});

module.exports = router;
