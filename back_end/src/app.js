// const bcrypt = require('bcrypt');
// const { PrismaClient } = require('@prisma/client');
// const prisma = new PrismaClient();

// app.post('/admin/login', async (req, res) => {
//   const { email, password } = req.body;

//   const user = await prisma.user.findUnique({ where: { email } });

//   if (!user || user.role !== 'ADMIN') {
//     return res.status(401).json({ message: 'Unauthorized' });
//   }

//   const valid = await bcrypt.compare(password, user.password);
//   if (!valid) {
//     return res.status(401).json({ message: 'Invalid credentials' });
//   }

//   req.session.userId = user.id;
//   req.session.role = user.role;

//   res.json({ message: 'Logged in successfully' });
// });

const express = require('express');
const cors = require('cors');
const session = require('express-session');
const { createClient } = require('redis');
const RedisStore = require('connect-redis').default;

const app = express();

// ── Middleware ──────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── CORS ────────────────────────────────────────────────
app.use(cors({
  origin: 'http://localhost:3000',
  credentials: true,
}));

// ── Redis Client ────────────────────────────────────────
const redisClient = createClient({ url: process.env.REDIS_URL });

redisClient.connect().catch((err) => {
  console.error('Redis connection failed:', err);
});

redisClient.on('ready', () => console.log('Redis connected'));
redisClient.on('error', (err) => console.error('Redis error:', err));

// ── Session ─────────────────────────────────────────────
app.use(session({
  store: new RedisStore({ client: redisClient }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    maxAge: 1000 * 60 * 60 * 8, // 8 hours
  }
}));

// ── Routes ───────────────────────────────────────────────
const adminRoutes = require('./routes/admin.routes');
app.use('/admin', adminRoutes);

// ── Health Check ─────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({ message: 'Admin API is running' });
});

module.exports = app;
