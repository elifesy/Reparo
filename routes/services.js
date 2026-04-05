const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db/setup');
const { auth } = require('../middleware/auth');
const router = express.Router();

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
    where.push('(s.id LIKE ? OR s.cust_name LIKE ? OR s.model LIKE ? OR s.issue_cat LIKE ?)');
    const like = `%${search}%`;
    params.push(like, like, like, like);
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

// ── GET /api/services/track/:id  (public — no auth needed) ──
router.get('/track/:id', (req, res) => {
  const svc = db.prepare('SELECT id,cust_name,device_type,brand,model,issue_cat,priority,status,eta,dispatch_at,last_activity,created_at,engineer_name,cost,notes FROM services WHERE id = ?').get(req.params.id);
  if (!svc) return res.status(404).json({ error: 'Service not found' });
  const activities = db.prepare('SELECT text,type,by_user,created_at FROM service_activity WHERE service_id = ? ORDER BY created_at ASC').all(req.params.id);
  res.json({ ...svc, activities });
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
