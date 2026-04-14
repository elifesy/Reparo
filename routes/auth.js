const express = require('express');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const { v4: uuidv4 } = require('uuid');
const db      = require('../db/setup');
const { auth, JWT_SECRET } = require('../middleware/auth');
const router  = express.Router();

// ── Rate limiters to defeat brute-force ──
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please try again in a few minutes.' },
});
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many registration attempts. Please try again later.' },
});

// ── Validators ──
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function validatePassword(pw) {
  if (typeof pw !== 'string' || pw.length < 8) return 'Password must be at least 8 characters';
  if (!/[a-z]/.test(pw)) return 'Password must contain a lowercase letter';
  if (!/[A-Z]/.test(pw)) return 'Password must contain an uppercase letter';
  if (!/\d/.test(pw))    return 'Password must contain a number';
  return null;
}

// POST /api/auth/login
router.post('/login', loginLimiter, (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase().trim());
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });
  if (user.status === 'Inactive') return res.status(403).json({ error: 'Account is deactivated' });

  const valid = bcrypt.compareSync(password, user.password);
  if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

  // Update last_active
  db.prepare('UPDATE users SET last_active = CURRENT_TIMESTAMP WHERE id = ?').run(user.id);

  // Log
  db.prepare('INSERT INTO audit_log(action,user_email,ip) VALUES(?,?,?)').run(
    `User login (${user.role})`, user.email, req.ip
  );

  const token = jwt.sign(
    { id: user.id, email: user.email, role: user.role, name: `${user.first_name} ${user.last_name}` },
    JWT_SECRET,
    { expiresIn: '8h' }
  );

  res.json({
    token,
    user: {
      id: user.id,
      firstName: user.first_name,
      lastName: user.last_name,
      name: `${user.first_name} ${user.last_name}`,
      email: user.email,
      phone: user.phone,
      role: user.role,
      status: user.status,
    }
  });
});

// POST /api/auth/register  (customers only)
router.post('/register', registerLimiter, (req, res) => {
  const { firstName, lastName, email, phone, password } = req.body;
  if (!firstName || !lastName || !email || !password)
    return res.status(400).json({ error: 'All fields required' });
  if (!EMAIL_RE.test(String(email).trim()))
    return res.status(400).json({ error: 'Please enter a valid email address' });
  const pwErr = validatePassword(password);
  if (pwErr) return res.status(400).json({ error: pwErr });

  const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase().trim());
  if (exists) return res.status(409).json({ error: 'Email already registered' });

  const id   = uuidv4();
  const hash = bcrypt.hashSync(password, 10);
  db.prepare(`INSERT INTO users(id,first_name,last_name,email,phone,password,role,status) VALUES(?,?,?,?,?,?,?,?)`)
    .run(id, firstName.trim(), lastName.trim(), email.toLowerCase().trim(), phone || '', hash, 'Customer', 'Active');

  db.prepare('INSERT INTO audit_log(action,user_email,ip) VALUES(?,?,?)').run(`New customer registered`, email, req.ip);

  const token = jwt.sign(
    { id, email: email.toLowerCase().trim(), role: 'Customer', name: `${firstName} ${lastName}` },
    JWT_SECRET,
    { expiresIn: '8h' }
  );

  res.status(201).json({
    token,
    user: { id, firstName, lastName, name: `${firstName} ${lastName}`, email, phone: phone||'', role:'Customer', status:'Active' }
  });
});

// GET /api/auth/me
router.get('/me', auth(), (req, res) => {
  const user = db.prepare('SELECT id,first_name,last_name,email,phone,role,status,created_at,last_active FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(user);
});

// PUT /api/auth/me  — update own profile
router.put('/me', auth(), (req, res) => {
  const { firstName, lastName, phone, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'Not found' });

  if (password) {
    const pwErr = validatePassword(password);
    if (pwErr) return res.status(400).json({ error: pwErr });
  }
  const newHash = password ? bcrypt.hashSync(password, 10) : user.password;
  db.prepare('UPDATE users SET first_name=?,last_name=?,phone=?,password=?,last_active=CURRENT_TIMESTAMP WHERE id=?')
    .run(firstName||user.first_name, lastName||user.last_name, phone||user.phone, newHash, user.id);

  res.json({ message: 'Profile updated' });
});

module.exports = router;
