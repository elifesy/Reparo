const express   = require('express');
const cors      = require('cors');
const path      = require('path');
const rateLimit = require('express-rate-limit');

const app = express();
const isProd = process.env.NODE_ENV === 'production';

// ── Hide framework fingerprint ──
app.disable('x-powered-by');

// ── Trust proxy (needed for correct req.ip + HTTPS detection behind Fly/Heroku/etc) ──
app.set('trust proxy', 1);

// ── HTTPS enforcement (production) ──
// Only redirect when we can see a forwarded header saying http — internal
// requests from Fly's health checker hit the app directly with no
// x-forwarded-proto at all, and must pass through unredirected.
if (isProd) {
  app.use((req, res, next) => {
    const xfp = req.header('x-forwarded-proto');
    if (!xfp || xfp === 'https' || req.secure) return next();
    return res.redirect(301, `https://${req.header('host')}${req.url}`);
  });
}

// ── Security headers ──
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-XSS-Protection', '0');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  if (isProd) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  // Conservative CSP — same-origin only, allows inline styles for the bundled SPA
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
  );
  next();
});

// ── CORS (allowlist via env, fallback to same-origin in prod / localhost in dev) ──
const allowedOrigins = (process.env.ALLOWED_ORIGINS || (isProd ? '' : 'http://localhost:3000'))
  .split(',').map(s => s.trim()).filter(Boolean);
app.use(cors({
  origin: (origin, cb) => {
    // Same-origin / curl / server-to-server requests have no Origin header
    if (!origin) return cb(null, true);
    if (allowedOrigins.includes(origin)) return cb(null, true);
    return cb(new Error('Origin not allowed by CORS'));
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  credentials: true,
  optionsSuccessStatus: 204,
}));

// ── Body parsing with size cap ──
app.use(express.json({ limit: '100kb', strict: true }));

// ── Global API rate limit (admins can be exempted in route-level limiters) ──
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please slow down.' },
});
app.use('/api', apiLimiter);

app.use(express.static(path.join(__dirname, 'public')));

// ── Routes ──
app.use('/api/auth',     require('./routes/auth'));
app.use('/api/services', require('./routes/services'));
app.use('/api',          require('./routes/admin'));
// ── ISOLATED FEATURE: data-purge (remove this line + routes/dataPurge.js to uninstall) ──
app.use('/api/data-purge', require('./routes/dataPurge'));

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
  if (!isProd) {
    console.log(`   Demo logins (development only):`);
    console.log(`     Admin     → admin@reparo.com   / Admin1234!`);
    console.log(`     Engineer  → m.alfarsi@reparo.com / Eng1234!`);
    console.log(`     Customer  → demo@reparo.com    / Demo1234!\n`);
  }
});
