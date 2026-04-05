const express = require('express');
const cors    = require('cors');
const path    = require('path');

const app = express();

// ── Middleware ──
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Routes ──
app.use('/api/auth',     require('./routes/auth'));
app.use('/api/services', require('./routes/services'));
app.use('/api',          require('./routes/admin'));

// ── Health check ──
app.get('/api/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

// ── Catch-all: serve frontend ──
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ── Error handler ──
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n⚡  Reparo running at http://localhost:${PORT}`);
  console.log(`   Database → ./db/reparo.sqlite`);
  console.log(`   Demo logins:`);
  console.log(`     Admin     → admin@reparo.com   / Admin1234!`);
  console.log(`     Engineer  → m.alfarsi@reparo.com / Eng1234!`);
  console.log(`     Customer  → demo@reparo.com    / Demo1234!\n`);
});
