const express = require('express');
const bcrypt  = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const db      = require('../db/setup');
const { auth } = require('../middleware/auth');

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
    where.push('(first_name||" "||last_name LIKE ? OR email LIKE ?)');
    params.push(`%${search}%`, `%${search}%`);
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

module.exports = router;
