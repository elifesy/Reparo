const jwt = require('jsonwebtoken');
const crypto = require('crypto');

let JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  if (process.env.NODE_ENV === 'production') {
    console.error('FATAL: JWT_SECRET environment variable must be set in production.');
    process.exit(1);
  }
  // Dev fallback: ephemeral random secret (tokens invalidated on restart — acceptable in dev)
  JWT_SECRET = crypto.randomBytes(48).toString('hex');
  console.warn('⚠️  JWT_SECRET not set — using ephemeral dev secret. Set JWT_SECRET in production.');
}

function auth(requiredRole) {
  return (req, res, next) => {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer '))
      return res.status(401).json({ error: 'No token provided' });

    try {
      const payload = jwt.verify(header.slice(7), JWT_SECRET);
      req.user = payload;

      if (requiredRole) {
        const roles = Array.isArray(requiredRole) ? requiredRole : [requiredRole];
        if (!roles.includes(payload.role))
          return res.status(403).json({ error: 'Insufficient permissions' });
      }
      next();
    } catch {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
  };
}

module.exports = { auth, JWT_SECRET };
