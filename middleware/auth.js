const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'reparo_dev_secret_change_in_prod_change_in_prod';

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
