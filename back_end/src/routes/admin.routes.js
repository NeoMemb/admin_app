const express = require('express');
const router = express.Router();
const { adminLogin, adminLogout, getDashboard } = require('../controllers/admin.controller');
const { requireAuth, requireAdmin } = require('../middleware/auth');

router.post('/login', adminLogin);
router.post('/logout', requireAuth, adminLogout);
router.get('/dashboard', requireAuth, requireAdmin, getDashboard);

module.exports = router;