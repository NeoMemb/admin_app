function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ message: 'Not authenticated' });
  }
  next();
}

function requireAdmin(req, res, next) {
  if (req.session.role !== 'ADMIN') {
    return res.status(403).json({ message: 'Forbidden' });
  }
  next();
}

module.exports = { requireAuth, requireAdmin };
