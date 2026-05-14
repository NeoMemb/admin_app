<!-- # admin_app -->
# admin_app
## Front_end
## Back_end

# 🛒 E-Commerce Admin Panel — Full Stack Documentation

> **Stack:** Next.js (TypeScript) · Express.js · PostgreSQL · Prisma · Redis · Session-Based Auth

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Folder Structure](#2-folder-structure)
3. [How the Frontend & Backend Connect](#3-how-the-frontend--backend-connect)
4. [Backend — Step by Step](#4-backend--step-by-step)
   - [Prisma Schema & Database](#41-prisma-schema--database)
   - [Seeding the Admin Account](#42-seeding-the-admin-account)
   - [Redis & Session Setup](#43-redis--session-setup)
   - [Prisma Client Singleton](#44-prisma-client-singleton)
   - [Controllers](#45-controllers)
   - [Middleware — RBAC](#46-middleware--rbac)
   - [Routes](#47-routes)
   - [Entry Point](#48-entry-point)
5. [Frontend — Step by Step](#5-frontend--step-by-step)
   - [Login Page](#51-login-page)
6. [Authentication Flow](#6-authentication-flow)
7. [Role-Based Access Control (RBAC)](#7-role-based-access-control-rbac)
8. [Environment Variables](#8-environment-variables)
9. [Running the Project](#9-running-the-project)
10. [Key Concepts Explained](#10-key-concepts-explained)

---

## 1. Project Overview

This is a full-stack e-commerce admin panel with:

- A **Next.js** frontend for the admin UI
- An **Express.js** backend REST API
- **PostgreSQL** as the primary database, managed by **Prisma ORM**
- **Redis** as the session store (replaces database session tables)
- **Session-based authentication** (no JWT, no localStorage tokens)
- **Role-Based Access Control (RBAC)** to protect admin routes

---

## 2. Folder Structure

```
admin_app/
│
├── back_end/                        # Express.js API
│   ├── src/
│   │   ├── app.js                   # Express setup: CORS, Redis, Session, Routes
│   │   ├── controllers/
│   │   │   └── admin.controller.js  # Login, logout, dashboard logic
│   │   ├── middleware/
│   │   │   └── auth.js              # requireAuth, requireAdmin guards
│   │   ├── routes/
│   │   │   └── admin.routes.js      # Route definitions
│   │   └── lib/
│   │       └── prisma.js            # Prisma client singleton
│   ├── prisma/
│   │   ├── schema.prisma            # Database schema + Role enum
│   │   └── seed.js                  # Seeds one admin account
│   ├── server.js                    # Entry point — starts the server
│   ├── .env                         # Environment variables
│   └── package.json
│
└── front_end/
    └── my-admin-app/                # Next.js (TypeScript) admin UI
        └── app/
            ├── (auth)/
            │   └── login/
            │       └── page.tsx     # Admin login page
            └── (dashboard)/
                └── page.tsx         # Protected dashboard
```

---

## 3. How the Frontend & Backend Connect

The frontend (Next.js on port `3000`) and backend (Express on port `5000`) are **two separate servers** that communicate over HTTP.

```
┌─────────────────────────┐          ┌──────────────────────────┐
│   FRONTEND (Next.js)    │          │   BACKEND (Express.js)   │
│   localhost:3000        │          │   localhost:5000          │
│                         │          │                          │
│  Login Page             │─────────▶│  POST /admin/login       │
│  page.tsx               │◀─────────│  Sets session cookie     │
│                         │          │                          │
│  Dashboard Page         │─────────▶│  GET /admin/dashboard    │
│                         │◀─────────│  Reads cookie → Redis    │
└─────────────────────────┘          └──────────────┬───────────┘
                                                     │
                                          ┌──────────▼──────────┐
                                          │  Redis (Sessions)    │
                                          │  { userId, role }    │
                                          └──────────┬──────────┘
                                                     │
                                          ┌──────────▼──────────┐
                                          │  PostgreSQL (Data)   │
                                          │  Users, Products...  │
                                          └─────────────────────┘
```

### The Connection Rules

| Concern | How it's handled |
|---|---|
| Cross-origin requests | `cors({ origin: 'http://localhost:3000', credentials: true })` on Express |
| Sending cookies cross-origin | `credentials: 'include'` on every `fetch` call in Next.js |
| Session persistence | Redis stores session data; browser holds only a cookie ID |
| Route protection | Express middleware checks Redis session before allowing access |

---

## 4. Backend — Step by Step

### 4.1 Prisma Schema & Database

**`back_end/prisma/schema.prisma`**

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum Role {
  ADMIN
  CUSTOMER
}

model User {
  id        String   @id @default(uuid())
  email     String   @unique
  password  String
  role      Role     @default(CUSTOMER)
  createdAt DateTime @default(now())
}
```

**What this does:**
- Defines a `User` table in PostgreSQL
- The `Role` enum restricts values to `ADMIN` or `CUSTOMER`
- Every new user defaults to `CUSTOMER` unless explicitly set

**Run migration:**
```bash
npx prisma migrate dev --name add_user_with_roles
```

---

### 4.2 Seeding the Admin Account

**`back_end/prisma/seed.js`**

```js
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');

const prisma = new PrismaClient();

async function main() {
  const hashedPassword = await bcrypt.hash('StrongAdminPass123!', 10);

  await prisma.user.upsert({
    where: { email: 'admin@yourstore.com' },
    update: {},
    create: {
      email: 'admin@yourstore.com',
      password: hashedPassword,
      role: 'ADMIN',
    },
  });

  console.log('Admin seeded.');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
```

**What this does:**
- Creates one admin account in the database with a **hashed password** (never plain text)
- Uses `upsert` so running it multiple times won't create duplicate admins
- `bcrypt.hash(password, 10)` — the `10` is the salt rounds (cost factor)

**Register in `package.json`:**
```json
"prisma": {
  "seed": "node prisma/seed.js"
}
```

**Run seed:**
```bash
npx prisma db seed
```

---

### 4.3 Redis & Session Setup

**`back_end/src/app.js`**

```js
const express = require('express');
const cors = require('cors');
const session = require('express-session');
const { createClient } = require('redis');
const RedisStore = require('connect-redis').default;

const app = express();

// Parse request bodies
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS — allow Next.js frontend to communicate with this API
app.use(cors({
  origin: 'http://localhost:3000',
  credentials: true,
}));

// Redis Client
const redisClient = createClient({ url: process.env.REDIS_URL });

redisClient.connect().catch((err) => {
  console.error('Redis connection failed:', err);
});

redisClient.on('ready', () => console.log('Redis connected'));
redisClient.on('error', (err) => console.error('Redis error:', err));

// Session — stored in Redis
app.use(session({
  store: new RedisStore({ client: redisClient }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,                                    // JS cannot access cookie
    secure: process.env.NODE_ENV === 'production',     // HTTPS only in production
    maxAge: 1000 * 60 * 60 * 8,                       // 8 hours
  }
}));

// Routes
const adminRoutes = require('./routes/admin.routes');
app.use('/admin', adminRoutes);

// Health check
app.get('/', (req, res) => {
  res.json({ message: 'Admin API is running' });
});

module.exports = app;
```

**What this does:**
- `express.json()` — lets Express read JSON request bodies
- `cors` — permits the frontend (port 3000) to send requests with cookies to the backend (port 5000)
- `redisClient` — connects to your local Redis instance
- `express-session` + `RedisStore` — every session is stored in Redis, not in memory or a DB table
- `httpOnly: true` — the session cookie cannot be read by JavaScript (prevents XSS attacks)

---

### 4.4 Prisma Client Singleton

**`back_end/src/lib/prisma.js`**

```js
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

module.exports = prisma;
```

**Why a singleton?**
Prisma should only have **one instance** running in your app. If you `new PrismaClient()` in every file, you'll exhaust your database connection pool. Import from this file everywhere instead.

---

### 4.5 Controllers

**`back_end/src/controllers/admin.controller.js`**

```js
const bcrypt = require('bcrypt');
const prisma = require('../lib/prisma');

// POST /admin/login
const adminLogin = async (req, res) => {
  try {
    const { email, password } = req.body;

    // 1. Find user by email
    const user = await prisma.user.findUnique({ where: { email } });

    // 2. Reject if user doesn't exist or isn't an ADMIN
    if (!user || user.role !== 'ADMIN') {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    // 3. Compare submitted password with hashed password in DB
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    // 4. Save user info to session (stored in Redis)
    req.session.userId = user.id;
    req.session.role = user.role;

    res.json({ message: 'Logged in successfully' });

  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ message: 'Internal server error' });
  }
};

// POST /admin/logout
const adminLogout = (req, res) => {
  req.session.destroy((err) => {
    if (err) return res.status(500).json({ message: 'Logout failed' });
    res.clearCookie('connect.sid');
    res.json({ message: 'Logged out successfully' });
  });
};

// GET /admin/dashboard
const getDashboard = (req, res) => {
  res.json({ message: 'Welcome, Admin' });
};

module.exports = { adminLogin, adminLogout, getDashboard };
```

**What this does:**
- `adminLogin` — validates email, checks role, compares hashed password, writes to session
- `adminLogout` — destroys session in Redis and clears the cookie from the browser
- `getDashboard` — a protected route that only responds if middleware passes

---

### 4.6 Middleware — RBAC

**`back_end/src/middleware/auth.js`**

```js
// Checks if the user has an active session
function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ message: 'Not authenticated' });
  }
  next();
}

// Checks if the authenticated user is an ADMIN
function requireAdmin(req, res, next) {
  if (req.session.role !== 'ADMIN') {
    return res.status(403).json({ message: 'Forbidden' });
  }
  next();
}

module.exports = { requireAuth, requireAdmin };
```

**What this does:**
- `requireAuth` — blocks unauthenticated users (no session = 401)
- `requireAdmin` — blocks authenticated non-admins (wrong role = 403)
- These are stacked on routes: `requireAuth` runs first, then `requireAdmin`

---

### 4.7 Routes

**`back_end/src/routes/admin.routes.js`**

```js
const express = require('express');
const router = express.Router();
const { adminLogin, adminLogout, getDashboard } = require('../controllers/admin.controller');
const { requireAuth, requireAdmin } = require('../middleware/auth');

router.post('/login', adminLogin);
router.post('/logout', requireAuth, adminLogout);
router.get('/dashboard', requireAuth, requireAdmin, getDashboard);

module.exports = router;
```

**Route summary:**

| Method | Route | Middleware | Description |
|---|---|---|---|
| POST | `/admin/login` | None | Authenticate and start session |
| POST | `/admin/logout` | requireAuth | Destroy session |
| GET | `/admin/dashboard` | requireAuth + requireAdmin | Protected admin page |

---

### 4.8 Entry Point

**`back_end/server.js`**

```js
require('dotenv').config();
const app = require('./src/app');

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
```

**What this does:**
- Loads `.env` variables before anything else
- Imports the configured Express app from `src/app.js`
- Starts the HTTP server on port 5000

---

## 5. Frontend — Step by Step

### 5.1 Login Page

**`front_end/my-admin-app/app/(auth)/login/page.tsx`**

```tsx
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function AdminLoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    setError('')

    try {
      const res = await fetch('http://localhost:5000/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',              // ← sends/receives session cookie
        body: JSON.stringify({ email, password }),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.message || 'Invalid email or password')
        return
      }

      router.push('/admin/dashboard')

    } catch (err) {
      setError('Something went wrong. Try again.')
    } finally {
      setIsLoading(false)
    }
  }

  // ... your JSX form
}
```

**What this does:**
- Sends `email` and `password` as JSON to the Express backend
- `credentials: 'include'` — **critical**: without this the browser won't store or send the session cookie across origins
- On success, redirects to the dashboard
- On failure, shows the error message from the backend

---

## 6. Authentication Flow

Here is the complete login-to-dashboard journey:

```
1. Admin fills in email + password on login page
        │
        ▼
2. Frontend sends POST http://localhost:5000/admin/login
   with { email, password } and credentials: 'include'
        │
        ▼
3. Express receives request
   → Queries PostgreSQL via Prisma for user by email
   → Checks user.role === 'ADMIN'
   → Compares password with bcrypt.compare()
        │
        ▼
4. On success:
   → Saves { userId, role } to Redis session
   → Browser receives Set-Cookie: connect.sid=<session_id>
        │
        ▼
5. Frontend redirects to /admin/dashboard
        │
        ▼
6. Dashboard page makes GET http://localhost:5000/admin/dashboard
   → Browser automatically sends connect.sid cookie
   → Express reads session ID → looks up Redis → finds { userId, role }
   → requireAuth passes ✓ → requireAdmin passes ✓
   → Returns dashboard data
```

---

## 7. Role-Based Access Control (RBAC)

RBAC means different users get different levels of access based on their **role**.

```
Request hits a protected route
        │
        ▼
requireAuth middleware
  → Does req.session.userId exist in Redis?
  → NO  → 401 Unauthorized (stop here)
  → YES → continue
        │
        ▼
requireAdmin middleware
  → Is req.session.role === 'ADMIN'?
  → NO  → 403 Forbidden (stop here)
  → YES → continue
        │
        ▼
Controller handles the request → 200 OK
```

This means even if someone is logged in as a `CUSTOMER`, they cannot access admin routes — they'll get a `403 Forbidden`.

---

## 8. Environment Variables

**`back_end/.env`**

```env
DATABASE_URL=postgresql://your_user:your_password@localhost:5432/your_db
REDIS_URL=redis://localhost:6379
SESSION_SECRET=your_strong_random_secret_here
NODE_ENV=development
PORT=5000
```

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string for Prisma |
| `REDIS_URL` | Redis connection for session storage |
| `SESSION_SECRET` | Signs the session cookie to prevent tampering |
| `NODE_ENV` | Controls whether cookies require HTTPS |
| `PORT` | Port Express listens on |

> ⚠️ Never commit `.env` to Git. Add it to `.gitignore`.

---

## 9. Running the Project

### Prerequisites
- Node.js installed
- PostgreSQL running
- Redis running (`redis-server`)

### Backend
```bash
cd back_end

# Install dependencies
npm install

# Run database migration
npx prisma migrate dev --name add_user_with_roles

# Seed the admin account
npx prisma db seed

# Start the server
node server.js

# Or with auto-restart on file changes
npx nodemon server.js
```

### Frontend
```bash
cd front_end/my-admin-app

# Install dependencies
npm install

# Start Next.js dev server
npm run dev
```

### Verify
- Backend: `http://localhost:5000/` → `{ "message": "Admin API is running" }`
- Frontend: `http://localhost:3000/admin/login`

---

## 10. Key Concepts Explained

### Why Session-Based Auth instead of JWT?
| | Session-Based | JWT |
|---|---|---|
| Where data lives | Redis (server) | Token (client) |
| Revocation | Instant (delete from Redis) | Hard (need a blocklist) |
| Best for | Admin panels, browser clients | Mobile apps, third-party APIs |
| Security | Server controls everything | Token valid until expiry |

For an admin panel accessed from a browser, sessions are the better choice.

---

### Why Redis instead of storing sessions in PostgreSQL?
- Redis is an **in-memory** store — session lookups are microseconds fast
- Sessions are temporary data; Redis handles expiry natively
- Keeps your PostgreSQL clean for actual business data

---

### Why bcrypt for passwords?
- Passwords are **never stored as plain text**
- `bcrypt.hash(password, 10)` — hashes the password with 10 salt rounds
- `bcrypt.compare(input, hash)` — safely compares without exposing the original
- Even if the database is compromised, passwords remain protected

---

### Why `credentials: 'include'` on fetch?
Browsers block cookies on cross-origin requests by default. Since your frontend (port 3000) and backend (port 5000) are different origins, you must explicitly tell the browser to include cookies. This works together with `credentials: true` in the Express CORS config.

---

*Documentation covers the complete implementation as built during this session.*