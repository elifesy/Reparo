const express = require('express');
const { v4: uuidv4 } = require('uuid');
const rateLimit = require('express-rate-limit');
const db = require('../db/setup');
const { auth } = require('../middleware/auth');
const { sendStatusNotification } = require('../utils/mailer');
const router = express.Router();

// ── Public tracking rate limiter: 20 requests per 15 minutes per IP ──────────
const trackLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many tracking requests. Please wait a few minutes and try again.' },
  keyGenerator: req => req.ip,
});

// ── Fields safe to expose publicly (no cost, no notes, no customer phone) ────
const PUBLIC_COLS = 'id,cust_name,device_type,brand,model,issue_cat,priority,status,eta,dispatch_at,last_activity,created_at,engineer_name';

// ── Normalise phone for comparison (strip spaces, dashes, +) ─────────────────
const normPhone = p => (p || '').replace(/[\s\-+()]/g, '');

// ── Verify the caller knows the customer's phone or email ─────────────────────
// Returns true if `verify` matches last-4 of phone OR full email (case-insensitive)
function verifyOwnership(svc, verify) {
  if (!verify) return false;
  const v = verify.trim().toLowerCase();
  // Email match
  if (v.includes('@') && svc.cust_email && svc.cust_email.toLowerCase() === v) return true;
  // Last-4 of phone
  const phone4 = normPhone(svc.cust_phone).slice(-4);
  if (/^\d{4}$/.test(v) && phone4 && phone4 === v) return true;
  return false;
}

// helper: attach activities to a service row
function withActivities(svc) {
  if (!svc) return null;
  svc.activities = db.prepare('SELECT * FROM service_activity WHERE service_id = ? ORDER BY created_at ASC').all(svc.id);
  svc.conditions = JSON.parse(svc.conditions || '[]');
  return svc;
}

// ── GET /api/services  (Engineer & Admin see all; Customer sees own) ──
router.get('/', auth(), (req, res) => {
  const { status, priority, engineer_id, search, limit = 200, offset = 0 } = req.query;

  let where = [];
  let params = [];

  if (req.user.role === 'Customer') {
    where.push('s.cust_id = ?'); params.push(req.user.id);
  }
  if (status)      { where.push('s.status = ?');      params.push(status); }
  if (priority)    { where.push('s.priority = ?');    params.push(priority); }
  if (engineer_id) { where.push('s.engineer_id = ?'); params.push(engineer_id); }
  if (search) {
    // Search across all meaningful service fields
    where.push(`(
      s.id          LIKE ? OR
      s.cust_name   LIKE ? OR
      s.cust_phone  LIKE ? OR
      s.cust_email  LIKE ? OR
      s.brand       LIKE ? OR
      s.model       LIKE ? OR
      s.device_type LIKE ? OR
      s.serial      LIKE ? OR
      s.imei        LIKE ? OR
      s.issue_cat   LIKE ? OR
      s.issue_desc  LIKE ? OR
      s.diagnosis   LIKE ? OR
      s.engineer_name LIKE ? OR
      s.notes       LIKE ? OR
      s.accessories LIKE ?
    )`);
    const like = `%${search}%`;
    params.push(like, like, like, like, like, like, like, like, like, like, like, like, like, like, like);
  }

  const whereStr = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const rows = db.prepare(`SELECT s.* FROM services s ${whereStr} ORDER BY s.created_at DESC LIMIT ? OFFSET ?`)
    .all(...params, Number(limit), Number(offset));

  res.json(rows.map(withActivities));
});

// ── GET /api/services/:id ──
router.get('/:id', auth(), (req, res) => {
  const svc = db.prepare('SELECT * FROM services WHERE id = ?').get(req.params.id);
  if (!svc) return res.status(404).json({ error: 'Not found' });
  if (req.user.role === 'Customer' && svc.cust_id !== req.user.id)
    return res.status(403).json({ error: 'Access denied' });
  res.json(withActivities(svc));
});

// ── GET /api/services/track/search  (public, rate-limited) ───────────────────
// Requires: ?q= (full email OR full phone ≥8 digits)
// ID lookups additionally require ?verify= (last-4 of phone OR full email)
// Never leaks cost, notes, or cust_phone.
router.get('/track/search', trackLimiter, (req, res) => {
  const q      = (req.query.q      || '').trim();
  const verify = (req.query.verify || '').trim();

  if (!q || q.length < 3)
    return res.status(400).json({ error: 'Enter at least 3 characters' });

  // Log to audit trail (IP-level, no PII stored)
  try {
    db.prepare('INSERT INTO audit_log(action,user_email,ip) VALUES(?,?,?)')
      .run(`Public track search`, 'public', req.ip);
  } catch {}

  const BLIND_ERROR = { error: 'No service request found. Check your details and try again.' };
  let rows = [];

  // ── Case 1: Looks like a service ID (RPR-XXXX) ──────────────────────────────
  if (/^RPR-\d+$/i.test(q)) {
    // ID lookup always requires ownership verification
    if (!verify)
      return res.status(400).json({ error: 'Please also enter the last 4 digits of your phone number, or your email address.' });

    const svc = db.prepare(`SELECT ${PUBLIC_COLS},cust_email,cust_phone FROM services WHERE UPPER(id)=UPPER(?)`).get(q);
    // Blind: same error whether ID not found OR verification wrong
    if (!svc || !verifyOwnership(svc, verify))
      return res.status(404).json(BLIND_ERROR);

    rows = [svc];
  }

  // ── Case 2: Full email ───────────────────────────────────────────────────────
  else if (q.includes('@')) {
    rows = db.prepare(`SELECT ${PUBLIC_COLS} FROM services WHERE LOWER(cust_email)=LOWER(?)`).all(q);
  }

  // ── Case 3: Phone number (≥8 digits after stripping) ────────────────────────
  else if (/^[\d+\s\-()]{8,}$/.test(q)) {
    const norm = normPhone(q);
    rows = db.prepare(`SELECT ${PUBLIC_COLS} FROM services WHERE REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(cust_phone,' ',''),'-',''),'+',''),'(',''),')','')=?`).all(norm);
  }

  // ── Anything else: reject (no partial/wildcard searches) ────────────────────
  else {
    return res.status(400).json({ error: 'Enter your full email address, full phone number, or service ID (RPR-XXXX).' });
  }

  if (rows.length === 0) return res.status(404).json(BLIND_ERROR);

  // Cap results & strip any lingering sensitive columns
  const safe = rows.slice(0, 5).map(({ cust_email, cust_phone, cost, notes, ...rest }) => rest);

  // Attach activities (public-safe fields only) for single result
  if (safe.length === 1) {
    safe[0].activities = db.prepare(
      'SELECT text,type,created_at FROM service_activity WHERE service_id=? ORDER BY created_at ASC'
    ).all(safe[0].id);
  }

  res.json({ results: safe, count: safe.length });
});

// ── GET /api/services/track/:id  (public, rate-limited) ──────────────────────
// Requires ?verify= (last-4 of phone OR full email). Blind on failure.
router.get('/track/:id', trackLimiter, (req, res) => {
  const verify = (req.query.verify || '').trim();

  if (!verify)
    return res.status(400).json({ error: 'Please provide the last 4 digits of your phone number, or your email address.' });

  try {
    db.prepare('INSERT INTO audit_log(action,user_email,ip) VALUES(?,?,?)')
      .run(`Public track by ID: ${req.params.id}`, 'public', req.ip);
  } catch {}

  const svc = db.prepare(
    `SELECT ${PUBLIC_COLS},cust_email,cust_phone FROM services WHERE id=?`
  ).get(req.params.id);

  // Blind: identical response whether not found or wrong verify
  if (!svc || !verifyOwnership(svc, verify))
    return res.status(404).json({ error: 'No service request found. Check your details and try again.' });

  const activities = db.prepare(
    'SELECT text,type,created_at FROM service_activity WHERE service_id=? ORDER BY created_at ASC'
  ).all(req.params.id);

  const { cust_email, cust_phone, ...publicSvc } = svc;
  res.json({ ...publicSvc, activities });
});

// ── POST /api/services  (Customer or Engineer) ──
router.post('/', auth(), (req, res) => {
  const {
    custId, custName, custPhone, custEmail,
    deviceType, brand, model, serial, imei, color, warranty, purchaseDate,
    issueCat, issueDesc, diagnosis, conditions, accessories,
    priority, engineerId, engineerName, cost, eta, contactPref, source, notes
  } = req.body;

  if (!custName || !deviceType || !brand || !model || !issueCat)
    return res.status(400).json({ error: 'Required fields missing' });

  const id = 'RPR-' + String(
    (db.prepare('SELECT COUNT(*)+1 as n FROM services').get().n)
  ).padStart(4,'0');

  const etaDate = eta ? new Date(eta).toISOString() : new Date(Date.now() + 5*86400000).toISOString();

  db.prepare(`
    INSERT INTO services(id,cust_id,cust_name,cust_phone,cust_email,device_type,brand,model,serial,imei,color,warranty,purchase_date,issue_cat,issue_desc,diagnosis,conditions,accessories,priority,status,engineer_id,engineer_name,cost,eta,contact_pref,source,notes)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    id,
    custId || req.user.id,
    custName, custPhone||'', custEmail||'',
    deviceType, brand, model, serial||'', imei||'', color||'',
    warranty||'Not sure', purchaseDate||'',
    issueCat, issueDesc||'', diagnosis||'',
    JSON.stringify(conditions||[]),
    accessories||'',
    priority||'Medium', 'Received',
    engineerId||null, engineerName||'',
    cost||0, etaDate, contactPref||'Phone call',
    source||'online', notes||''
  );

  // First activity
  const byUser = req.user.role === 'Customer' ? `${req.user.name} (Customer)` : req.user.name;
  db.prepare('INSERT INTO service_activity(service_id,text,type,by_user) VALUES(?,?,?,?)')
    .run(id, source === 'walk-in' ? `Walk-in intake recorded by ${req.user.name}` : 'Service request submitted online', 'intake', byUser);

  db.prepare('INSERT INTO audit_log(action,user_email,ip) VALUES(?,?,?)').run(`Service ${id} created`, req.user.email, req.ip);

  const created = withActivities(db.prepare('SELECT * FROM services WHERE id = ?').get(id));
  res.status(201).json(created);
});

// ── PATCH /api/services/:id  (Engineer & Admin) ──
router.patch('/:id', auth(['Engineer','Admin']), (req, res) => {
  const svc = db.prepare('SELECT * FROM services WHERE id = ?').get(req.params.id);
  if (!svc) return res.status(404).json({ error: 'Not found' });

  const { status, priority, engineerId, engineerName, cost, eta, notes, diagnosis, addNote } = req.body;
  const changes = [];

  if (status && status !== svc.status) {
    db.prepare('UPDATE services SET status=?,last_activity=CURRENT_TIMESTAMP WHERE id=?').run(status, svc.id);
    if (status === 'Dispatched')
      db.prepare('UPDATE services SET dispatch_at=CURRENT_TIMESTAMP WHERE id=?').run(svc.id);
    db.prepare('INSERT INTO service_activity(service_id,text,type,by_user) VALUES(?,?,?,?)')
      .run(svc.id, `Status changed from ${svc.status} to ${status}`, 'status_change', req.user.name);
    changes.push(`status → ${status}`);
    // Fire-and-forget email notification to customer
    const updatedSvc = db.prepare('SELECT * FROM services WHERE id=?').get(svc.id);
    sendStatusNotification(updatedSvc, status).catch(e => console.error('Email notification failed:', e.message));
  }
  if (cost !== undefined && Number(cost) !== svc.cost) {
    db.prepare('UPDATE services SET cost=? WHERE id=?').run(Number(cost), svc.id);
    changes.push(`cost → AED ${cost}`);
  }
  if (engineerId && engineerId !== svc.engineer_id) {
    db.prepare('UPDATE services SET engineer_id=?,engineer_name=?,last_activity=CURRENT_TIMESTAMP WHERE id=?').run(engineerId, engineerName||'', svc.id);
    db.prepare('INSERT INTO service_activity(service_id,text,type,by_user) VALUES(?,?,?,?)')
      .run(svc.id, `Reassigned from ${svc.engineer_name} to ${engineerName}`, 'reassign', req.user.name);
    changes.push(`reassigned to ${engineerName}`);
  }
  if (eta) { db.prepare('UPDATE services SET eta=? WHERE id=?').run(new Date(eta).toISOString(), svc.id); changes.push('ETA updated'); }
  if (notes !== undefined) { db.prepare('UPDATE services SET notes=? WHERE id=?').run(notes, svc.id); changes.push('notes updated'); }
  if (diagnosis) { db.prepare('UPDATE services SET diagnosis=? WHERE id=?').run(diagnosis, svc.id); changes.push('diagnosis updated'); }
  if (addNote) {
    db.prepare('INSERT INTO service_activity(service_id,text,type,by_user) VALUES(?,?,?,?)')
      .run(svc.id, addNote, 'note', req.user.name);
    db.prepare('UPDATE services SET last_activity=CURRENT_TIMESTAMP WHERE id=?').run(svc.id);
    changes.push('note added');
  }

  if (changes.length)
    db.prepare('INSERT INTO audit_log(action,user_email,ip) VALUES(?,?,?)').run(`Service ${svc.id} updated: ${changes.join(', ')}`, req.user.email, req.ip);

  res.json({ message: 'Updated', changes, service: withActivities(db.prepare('SELECT * FROM services WHERE id=?').get(svc.id)) });
});

// ── DELETE /api/services/:id  (Admin only) ──
router.delete('/:id', auth('Admin'), (req, res) => {
  const svc = db.prepare('SELECT id FROM services WHERE id=?').get(req.params.id);
  if (!svc) return res.status(404).json({ error: 'Not found' });
  db.prepare('DELETE FROM services WHERE id=?').run(req.params.id);
  db.prepare('INSERT INTO audit_log(action,user_email,ip) VALUES(?,?,?)').run(`Service ${req.params.id} deleted`, req.user.email, req.ip);
  res.json({ message: 'Deleted' });
});

// ── GET /api/services/stats/overview  (Admin & Engineer) ──
router.get('/stats/overview', auth(['Engineer','Admin']), (req, res) => {
  const isEng = req.user.role === 'Engineer';
  const engFilter = isEng ? `WHERE engineer_id = '${req.user.id}'` : '';

  const total   = db.prepare(`SELECT COUNT(*) as n FROM services ${engFilter}`).get().n;
  const active  = db.prepare(`SELECT COUNT(*) as n FROM services ${engFilter ? engFilter+' AND' : 'WHERE'} status NOT IN ('Dispatched','Cancelled')`).get().n;
  const ready   = db.prepare(`SELECT COUNT(*) as n FROM services ${engFilter ? engFilter+' AND' : 'WHERE'} status='Ready'`).get().n;
  const dispatched = db.prepare(`SELECT COUNT(*) as n FROM services ${engFilter ? engFilter+' AND' : 'WHERE'} status='Dispatched'`).get().n;
  const overdue = db.prepare(`SELECT COUNT(*) as n FROM services ${engFilter ? engFilter+' AND' : 'WHERE'} eta < datetime('now') AND status NOT IN ('Dispatched','Cancelled')`).get().n;
  const revenue = db.prepare(`SELECT COALESCE(SUM(cost),0) as n FROM services WHERE status='Dispatched'`).get().n;
  const highPri = db.prepare(`SELECT COUNT(*) as n FROM services ${engFilter ? engFilter+' AND' : 'WHERE'} priority='High' AND status NOT IN ('Dispatched','Cancelled')`).get().n;

  const byStatus = db.prepare(`SELECT status, COUNT(*) as count FROM services GROUP BY status`).all();
  const byDevice = db.prepare(`SELECT device_type, COUNT(*) as count FROM services GROUP BY device_type ORDER BY count DESC`).all();
  const byIssue  = db.prepare(`SELECT issue_cat, COUNT(*) as count FROM services GROUP BY issue_cat ORDER BY count DESC`).all();

  res.json({ total, active, ready, dispatched, overdue, revenue, highPri, byStatus, byDevice, byIssue });
});

module.exports = router;
