const express = require('express');
const bcrypt  = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const db      = require('../db/setup');
const { auth } = require('../middleware/auth');
const { sendTestEmail } = require('../utils/mailer');

const router = express.Router();

// ══════════════════════════════════════
// USERS  (Admin only except GET self)
// ══════════════════════════════════════

router.get('/users', auth(['Admin']), (req, res) => {
  const { role, status, search } = req.query;
  let where = [], params = [];
  if (role)   { where.push('role = ?');   params.push(role); }
  if (status) { where.push('status = ?'); params.push(status); }
  if (search) {
    where.push('(first_name||" "||last_name LIKE ? OR email LIKE ? OR phone LIKE ? OR role LIKE ?)');
    const like = `%${search}%`;
    params.push(like, like, like, like);
  }
  const whereStr = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const rows = db.prepare(`SELECT id,first_name,last_name,email,phone,role,status,created_at,last_active FROM users ${whereStr} ORDER BY created_at DESC`).all(...params);
  // attach service count
  const withCount = rows.map(u => ({
    ...u,
    service_count: db.prepare('SELECT COUNT(*) as n FROM services WHERE cust_id=? OR engineer_id=?').get(u.id,u.id).n
  }));
  res.json(withCount);
});

router.post('/users', auth(['Admin']), (req, res) => {
  const { firstName, lastName, email, phone, role, status, password } = req.body;
  if (!firstName||!lastName||!email) return res.status(400).json({ error: 'Name and email required' });
  if (db.prepare('SELECT id FROM users WHERE email=?').get(email.toLowerCase().trim()))
    return res.status(409).json({ error: 'Email already exists' });
  const id   = uuidv4();
  const hash = bcrypt.hashSync(password||'TempPass1!', 10);
  db.prepare(`INSERT INTO users(id,first_name,last_name,email,phone,password,role,status) VALUES(?,?,?,?,?,?,?,?)`)
    .run(id, firstName.trim(), lastName.trim(), email.toLowerCase().trim(), phone||'', hash, role||'Customer', status||'Active');
  db.prepare('INSERT INTO audit_log(action,user_email,ip) VALUES(?,?,?)').run(`Admin created user ${email}`, req.user.email, req.ip);
  res.status(201).json({ id, message: 'User created' });
});

router.put('/users/:id', auth(['Admin']), (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
  if (!u) return res.status(404).json({ error: 'Not found' });
  const { firstName, lastName, email, phone, role, status, password } = req.body;
  const hash = password ? bcrypt.hashSync(password, 10) : u.password;
  db.prepare('UPDATE users SET first_name=?,last_name=?,email=?,phone=?,role=?,status=?,password=? WHERE id=?')
    .run(firstName||u.first_name, lastName||u.last_name, email||u.email, phone||u.phone, role||u.role, status||u.status, hash, u.id);
  db.prepare('INSERT INTO audit_log(action,user_email,ip) VALUES(?,?,?)').run(`User ${u.email} updated`, req.user.email, req.ip);
  res.json({ message: 'Updated' });
});

router.delete('/users/:id', auth(['Admin']), (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
  if (!u) return res.status(404).json({ error: 'Not found' });
  if (u.id === req.user.id) return res.status(400).json({ error: 'Cannot delete your own account' });
  db.prepare('DELETE FROM users WHERE id=?').run(req.params.id);
  db.prepare('INSERT INTO audit_log(action,user_email,ip) VALUES(?,?,?)').run(`User ${u.email} deleted`, req.user.email, req.ip);
  res.json({ message: 'Deleted' });
});

router.patch('/users/:id/status', auth(['Admin']), (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id);
  if (!u) return res.status(404).json({ error: 'Not found' });
  const newStatus = u.status === 'Active' ? 'Inactive' : 'Active';
  db.prepare('UPDATE users SET status=? WHERE id=?').run(newStatus, u.id);
  db.prepare('INSERT INTO audit_log(action,user_email,ip) VALUES(?,?,?)').run(`User ${u.email} status → ${newStatus}`, req.user.email, req.ip);
  res.json({ status: newStatus });
});

// ══════════════════════════════════════
// ANNOUNCEMENTS
// ══════════════════════════════════════

router.get('/announcements', (req, res) => {
  const rows = db.prepare('SELECT * FROM announcements ORDER BY created_at DESC').all();
  res.json(rows);
});

router.post('/announcements', auth(['Admin']), (req, res) => {
  const { text, type, audience } = req.body;
  if (!text) return res.status(400).json({ error: 'Text required' });
  const id = 'ann' + Date.now();
  db.prepare('INSERT INTO announcements(id,text,type,audience) VALUES(?,?,?,?)').run(id, text, type||'info', audience||'All users');
  db.prepare('INSERT INTO audit_log(action,user_email,ip) VALUES(?,?,?)').run('Announcement published', req.user.email, req.ip);
  res.status(201).json({ id, message: 'Published' });
});

router.patch('/announcements/:id', auth(['Admin']), (req, res) => {
  const ann = db.prepare('SELECT * FROM announcements WHERE id=?').get(req.params.id);
  if (!ann) return res.status(404).json({ error: 'Not found' });
  if (req.body.active !== undefined)
    db.prepare('UPDATE announcements SET active=? WHERE id=?').run(req.body.active ? 1 : 0, ann.id);
  res.json({ message: 'Updated' });
});

router.delete('/announcements/:id', auth(['Admin']), (req, res) => {
  db.prepare('DELETE FROM announcements WHERE id=?').run(req.params.id);
  res.json({ message: 'Deleted' });
});

// ══════════════════════════════════════
// SETTINGS  (Admin only)
// ══════════════════════════════════════

// Public — only branding fields needed before login
router.get('/branding', (req, res) => {
  const keys = ['portal_name','nav_brand_text','portal_logo'];
  const obj = {};
  keys.forEach(k => {
    const row = db.prepare('SELECT value FROM settings WHERE key=?').get(k);
    obj[k] = row ? row.value : '';
  });
  res.json(obj);
});

router.get('/settings', auth(['Admin']), (req, res) => {
  const rows = db.prepare('SELECT key,value FROM settings').all();
  const obj = {};
  rows.forEach(r => obj[r.key] = r.value);
  res.json(obj);
});

router.put('/settings', auth(['Admin']), (req, res) => {
  const upsert = db.prepare('INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)');
  const upsertAll = db.transaction(entries => {
    for (const [k, v] of entries) upsert.run(k, String(v));
  });
  upsertAll(Object.entries(req.body));
  db.prepare('INSERT INTO audit_log(action,user_email,ip) VALUES(?,?,?)').run('Settings updated', req.user.email, req.ip);
  res.json({ message: 'Settings saved' });
});

// ══════════════════════════════════════
// AUDIT LOG  (Admin only)
// ══════════════════════════════════════

router.get('/audit', auth(['Admin']), (req, res) => {
  const rows = db.prepare('SELECT * FROM audit_log ORDER BY created_at DESC LIMIT 100').all();
  res.json(rows);
});

// ══════════════════════════════════════
// TEST EMAIL
// ══════════════════════════════════════

router.post('/test-email', auth(['Admin']), async (req, res) => {
  const { to } = req.body;
  if (!to) return res.status(400).json({ error: 'Recipient email required' });
  try {
    await sendTestEmail(to);
    db.prepare('INSERT INTO audit_log(action,user_email,ip) VALUES(?,?,?)').run(`Test email sent to ${to}`, req.user.email, req.ip);
    res.json({ message: 'Test email sent successfully' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ══════════════════════════════════════
// STORAGE STATS
// ══════════════════════════════════════

router.get('/storage-stats', auth(['Admin']), (req, res) => {
  const stats = {
    users:            db.prepare('SELECT COUNT(*) as n FROM users').get().n,
    services:         db.prepare('SELECT COUNT(*) as n FROM services').get().n,
    service_activity: db.prepare('SELECT COUNT(*) as n FROM service_activity').get().n,
    announcements:    db.prepare('SELECT COUNT(*) as n FROM announcements').get().n,
    audit_log:        db.prepare('SELECT COUNT(*) as n FROM audit_log').get().n,
    settings:         db.prepare('SELECT COUNT(*) as n FROM settings').get().n,
  };
  try {
    const fs = require('fs');
    const path = require('path');
    const dbPath = process.env.NODE_ENV === 'production'
      ? '/data/reparo.sqlite'
      : path.join(__dirname, '../db/reparo.sqlite');
    stats.db_size_bytes = fs.statSync(dbPath).size;
  } catch { stats.db_size_bytes = null; }
  res.json(stats);
});

// ══════════════════════════════════════
// CLEAR ALL DATA & RESET
// ══════════════════════════════════════

router.post('/clear-data', auth(['Admin']), (req, res) => {
  try {
    db.transaction(() => {
      db.prepare('DELETE FROM service_activity').run();
      db.prepare('DELETE FROM services').run();
      db.prepare('DELETE FROM users').run();
      db.prepare('DELETE FROM announcements').run();
      db.prepare('DELETE FROM audit_log').run();
      db.prepare(`DELETE FROM settings WHERE key IN (
        'portal_logo','nav_brand_text','smtp_host','smtp_port','smtp_user',
        'smtp_pass','smtp_from_name','smtp_from_email','smtp_secure',
        'email_notify_enabled','email_notify_statuses'
      )`).run();
    })();
    const insertSetting = db.prepare('INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)');
    // Re-insert default settings
    const defaults = {
      working_hours:'9:00 AM – 6:00 PM, Sat–Thu', express_fee:'50', sla_days:'5', max_jobs:'8',
      portal_name:'Reparo', support_phone:'+971 4 000 0000', support_email:'support@reparo.com',
      tagline:'Intelligent Device Service Management',
      notif_sms:'1', notif_email:'1', notif_whatsapp:'1', notif_digest:'0',
      sec_2fa:'1', sec_timeout:'1', sec_audit:'1',
      portal_logo:'', nav_brand_text:'', nav_show_name:'1',
      smtp_host:'', smtp_port:'587', smtp_user:'', smtp_pass:'',
      smtp_from_name:'', smtp_from_email:'', smtp_secure:'0',
      email_notify_enabled:'0', email_notify_statuses:'["Diagnosed","Ready","Dispatched"]',
    };
    for (const [k,v] of Object.entries(defaults)) insertSetting.run(k,v);
    // Re-seed users, services, announcements
    const { seed } = require('./seedHelper');
    seed(db);
    res.json({ message: 'All data cleared and reset to defaults.' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
