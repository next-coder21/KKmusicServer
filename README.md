<div align="center">

# KKaudioBk

### Music Streaming Backend API

*Production-grade REST API powering the KK-lisn music streaming platform — built with Node.js, Express, and PostgreSQL*

---

[![Node.js](https://img.shields.io/badge/Node.js-≥18-339933?style=flat-square&logo=nodedotjs&logoColor=white)](https://nodejs.org)
[![Express](https://img.shields.io/badge/Express-4.21-000000?style=flat-square&logo=express&logoColor=white)](https://expressjs.com)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-Neon-336791?style=flat-square&logo=postgresql&logoColor=white)](https://neon.tech)
[![JWT](https://img.shields.io/badge/Auth-JWT-000000?style=flat-square&logo=jsonwebtokens&logoColor=white)](https://jwt.io)
[![Groq](https://img.shields.io/badge/AI-Groq_SDK-orange?style=flat-square)](https://groq.com)
[![Render](https://img.shields.io/badge/Deployed-Render-46E3B7?style=flat-square&logo=render&logoColor=black)](https://render.com)

</div>

---

## What Is This?

KKaudioBk is the **backend REST API** for [KK-lisn](../KK-lisn) — a Christian music streaming platform built to archive and stream songs from the Kanyakumari VBS (Vacation Bible School) events from 2020–2024.

It handles everything the frontend can't: **audio streaming with HTTP range support**, **JWT authentication with dual user/admin sessions**, **playlist and queue management**, **AI-powered lyric generation via Groq**, and a **full admin CMS** — all served from a single Express server backed by a PostgreSQL database on Neon.

> **License Notice:** This codebase is publicly visible for educational and portfolio reference only. It may not be copied, modified, distributed, or used in any project without explicit permission.

---

## Feature Overview

### Core API Capabilities

| Domain | What It Does |
|---|---|
| **Audio Streaming** | HTTP Range-aware streaming from Google Drive — supports seek, resume, and partial content (206) |
| **Music Catalog** | Songs, albums, artists, and genres with full metadata |
| **User Auth** | JWT + HttpOnly cookie sessions, bcrypt password hashing, security-question password reset |
| **Admin Auth** | Separate JWT with isolated credentials — no privilege escalation from user tokens |
| **Playlists** | Full CRUD — create, rename, add/remove songs, delete |
| **Queue** | Per-user playback queue with add, remove, and clear |
| **Favorites** | Toggle favorites, retrieve liked songs |
| **Play History** | Record plays, retrieve history, clear history |
| **Lyrics** | Store and retrieve LRC-format synchronized lyrics per song |
| **Search** | Cross-entity search — songs, artists, albums in a single query |
| **User Analytics** | Listening stats, top genres by play count, session tracking |
| **Notifications** | Per-user notifications with read/unread state |
| **Announcements** | Scheduled, typed announcements with media upload, publish flow, and impression stats |
| **Ads** | Active ad retrieval with impression tracking |
| **AI Lyric Generation** | Admin-triggered speech-to-text via Groq with hallucination filtering and multi-pass refinement |
| **Email** | Transactional email via an external Render-hosted mail engine with cold-start retry logic |

---

## Tech Stack

```
Runtime & Framework
├── Node.js ≥18       — Runtime
└── Express 4.21      — HTTP server and routing

Database
└── PostgreSQL (pg)   — Primary datastore via Neon (Supabase/Railway compatible)

Authentication & Security
├── jsonwebtoken      — JWT generation and verification
├── bcryptjs          — Password hashing (bcrypt, salt=10)
├── helmet            — Security headers (crossOriginResourcePolicy: cross-origin for audio)
├── cors              — Dynamic origin validation (allowlist + *.vercel.app wildcard)
└── cookie-parser     — HttpOnly cookie parsing

File & Request Handling
├── multer            — Multipart file uploads (memory storage)
├── body-parser       — JSON and urlencoded body parsing
└── express-validator — Input validation and sanitization

External Integrations
├── axios             — Google Drive URL resolution and HTTP HEAD probing
├── groq-sdk          — AI speech-to-text for lyric generation
└── nodemailer        — Email (routed through external mail engine)

Developer Experience
├── dotenv            — Environment variable management
└── node --watch      — Zero-config hot reload in development
```

---

## Architecture

```
KKaudioBk/
├── server.js                   # Entry point — binds Express app to PORT
└── src/
    ├── app.js                  # Middleware stack, route mounting, error handlers
    ├── config/
    │   └── db.js               # PostgreSQL connection pool
    ├── routes/
    │   ├── authRoutes.js       # /auth — user auth, playlists, history, search, notifications
    │   ├── musicRoutes.js      # /auth/music — catalog, streaming, lyrics, covers
    │   ├── queueRoutes.js      # /auth/queue — queue management
    │   ├── favouriteRoutes.js  # /auth/favourites — favorites toggle and retrieval
    │   └── adminRoutes.js      # /admin — full CMS, analytics, AI lyric gen
    ├── controllers/
    │   ├── authController.js          # Registration, login, account update
    │   ├── musicController.js         # Song browsing, Drive streaming, lyrics
    │   ├── userController.js          # Stats, history, playlists, search, notifications
    │   ├── queueController.js         # Queue CRUD
    │   ├── favouriteController.js     # Favorites logic
    │   ├── adminController.js         # Admin CRUD — songs, artists, albums, users
    │   ├── announcementController.js  # Announcement lifecycle with scheduling & stats
    │   ├── adController.js            # Ad management and active ad retrieval
    │   └── lyricgenController.js      # Groq AI pipeline — transcription + filtering
    ├── middleware/
    │   ├── authMiddleware.js          # User JWT validation → req.user
    │   └── adminAuthMiddleware.js     # Admin JWT validation → req.admin
    ├── models/                        # Schema init helpers
    └── utils/
        └── email.js                   # External mail engine client with retry logic
```

---

## Database Schema

23 PostgreSQL tables across 6 logical domains:

```
Users & Auth
├── users               — Email, password hash, name, security answer
├── user_profiles       — DOB, gender, profile image
├── admin_users         — Admin accounts with role field
└── user_sessions       — Active session tracking

Music Catalog
├── genres              — Genre list
├── artists             — Artist info and bio
├── albums              — Album metadata with cover
├── songs               — Full song record (title, Drive URL, duration, lyrics, play_count)
└── album_songs         — Song ↔ Album join table

User Interactions
├── playlists           — User-created playlists
├── playlist_songs      — Playlist ↔ Song join table
├── queue               — Per-user ordered playback queue
├── favourites          — Liked songs
├── play_history        — Per-play activity log with timestamp
├── search_history      — Search query log
└── song_ratings        — User song ratings

Analytics
├── user_listening_stats — Aggregated listening metrics
└── artist_follows       — Artist follow tracking

Content & Features
├── announcements       — Typed announcements with scheduling, image, and impression stats
├── ads                 — Ad entries with active/inactive state and scheduling
├── ad_impressions      — Ad impression events
├── notifications       — Per-user notifications with read state
└── content_reports     — User-submitted content violation reports
```

---

## API Reference

### Auth & User — `/auth`

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/auth/register` | — | Register new user |
| `POST` | `/auth/login` | — | Login, receive JWT cookie |
| `POST` | `/auth/logout` | — | Clear session cookie |
| `GET` | `/auth/check-auth` | User | Validate current session |
| `POST` | `/auth/verify-security` | — | Verify security answer |
| `POST` | `/auth/reset-password` | — | Reset password |
| `POST` | `/auth/update-account` | User | Update profile (with image) |
| `DELETE` | `/auth/account` | User | Delete account |
| `GET` | `/auth/search` | User | Search songs, artists, albums |
| `GET` | `/auth/stats` | User | Listening stats |
| `GET` | `/auth/play-history` | User | Recent play history |
| `DELETE` | `/auth/play-history` | User | Clear play history |
| `GET` | `/auth/top-genres` | User | Top genres by plays |
| `GET` | `/auth/sessions` | User | Active sessions |

### Playlists — `/auth/playlists`

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/auth/playlists` | List user playlists |
| `POST` | `/auth/playlists` | Create playlist |
| `PATCH` | `/auth/playlists/:id` | Rename/update playlist |
| `DELETE` | `/auth/playlists/:id` | Delete playlist |
| `GET` | `/auth/playlists/:id/songs` | Get songs in playlist |
| `POST` | `/auth/playlists/:id/songs` | Add song to playlist |
| `DELETE` | `/auth/playlists/:id/songs/:songId` | Remove song from playlist |

### Music Catalog — `/auth/music`

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/auth/music/songs` | — | All songs with metadata |
| `GET` | `/auth/music/songs/:id` | — | Single song |
| `GET` | `/auth/music/albums` | — | All albums |
| `GET` | `/auth/music/albums/:id/songs` | — | Songs in album |
| `GET` | `/auth/music/artists` | — | All artists |
| `GET` | `/auth/music/genres` | — | All genres |
| `GET` | `/auth/music/stream/:id` | — | **Stream audio** (HTTP 206, Range support) |
| `GET` | `/auth/music/cover/:id` | — | Song cover image |
| `GET` | `/auth/music/songs/:id/lyrics` | — | LRC or plain-text lyrics |
| `POST` | `/auth/music/songs/:id/lyrics` | User | Save lyrics |
| `POST` | `/auth/music/record-play/:id` | User | Record a play event |

### Queue & Favorites

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/auth/queue` | Get user queue |
| `POST` | `/auth/queue/add` | Add songs to queue |
| `POST` | `/auth/queue/remove` | Remove songs from queue |
| `DELETE` | `/auth/queue/clear` | Clear queue |
| `GET` | `/auth/favourites` | Get favorites |
| `POST` | `/auth/favourites/add` | Toggle add favorite |
| `POST` | `/auth/favourites/remove` | Remove from favorites |

### Admin — `/admin` *(admin token required)*

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/admin/login` | Admin login |
| `GET` | `/admin/check-auth` | Verify admin session |
| `GET` | `/admin/stats` | Dashboard statistics |
| `GET/POST/PATCH/DELETE` | `/admin/songs/:id?` | Song CRUD |
| `GET/POST/PATCH/DELETE` | `/admin/artists/:id?` | Artist CRUD |
| `GET/POST/PATCH/DELETE` | `/admin/albums/:id?` | Album CRUD |
| `GET/DELETE` | `/admin/users/:id?` | User management |
| `GET/POST/PUT/DELETE` | `/admin/announcements/:id?` | Announcement lifecycle |
| `POST` | `/admin/announcements/:id/publish` | Publish announcement |
| `GET` | `/admin/announcements/:id/stats` | Impression stats |
| `GET/POST/PATCH/DELETE` | `/admin/ads/:id?` | Ad management |
| `GET/PATCH` | `/admin/reports/:id?` | Content moderation |
| `POST` | `/admin/lyricgen` | **AI lyric generation** |

### Health

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/health` | Server status, uptime, timestamp |

---

## Audio Streaming Design

Audio files are hosted on Google Drive. The streaming pipeline resolves them server-side:

```
Client: GET /auth/music/stream/:id
         ↓
1. Look up song record — extract Drive URL from database
2. Resolve Drive file ID (supports /d/{id} and ?id= URL formats)
3. Check in-process URL cache (50-minute TTL) to avoid re-resolving
4. If not cached: follow Drive redirect → extract confirmed download URL
   (handles Google's virus-scan confirmation token for large files)
5. Probe file size via HTTP HEAD request
6. Honour incoming Range header → pipe 206 Partial Content response
7. Forward response headers: Content-Type, Content-Length, Accept-Ranges
```

This means the client never touches Google Drive directly — the backend resolves, caches, and proxies the stream. This is required because Drive URLs embed short-lived tokens that can't be used from the browser.

---

## AI Lyric Generation

The `/admin/lyricgen` endpoint runs a multi-step pipeline:

```
1. Receive audio file from admin
2. Submit to Groq speech-to-text (Whisper-large-v3)
3. Hallucination filtering:
   ├── Latin-script heuristics (repetition detection, stuck-loop patterns)
   ├── Non-Latin script detection for Tamil, Hindi, Telugu, Malayalam, etc.
   └── Low-confidence word ratio threshold
4. If confidence is borderline → second-pass transcription with adjusted params
5. Return clean LRC-formatted lyrics with timestamps
```

Supports 15+ languages including Tamil, Hindi, Telugu, Malayalam, Kannada, Bengali, Korean, Japanese, Arabic, and English.

---

## Authentication Design

### Dual-Session Architecture

```
User Session                          Admin Session
─────────────────────────────         ──────────────────────────────
JWT expiry: 7 days                    JWT expiry: 24 hours
Stored in: token (HttpOnly cookie)    Stored in: admin_token (HttpOnly cookie)
Fallback:  Authorization header       Fallback:  Authorization header (priority)
Payload:   { email, name }            Payload:   { email, role, isAdmin: true }
```

Admin tokens are completely isolated from user tokens. A user Bearer token cannot reach any `/admin` endpoint — the `adminAuthMiddleware` checks `payload.isAdmin === true` independently.

### Cookie Security

| Property | Production | Development |
|---|---|---|
| `HttpOnly` | true | true |
| `Secure` | true | false |
| `SameSite` | None (cross-site) | Lax |
| `MaxAge` | 7d (user) / 1d (admin) | same |

---

## Getting Started

### Prerequisites

- Node.js 18+
- PostgreSQL database (Neon recommended — free tier works)

### Local Setup

```bash
# Clone
git clone https://github.com/next-coder21/KKaudioBk.git
cd KKaudioBk

# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Fill in all required values (see Environment Variables below)

# Run database migrations
npm run migrate

# Start development server (with hot reload)
npm run dev

# Or start production server
npm start
```

### Environment Variables

```env
# Database
DATABASE_URL=postgresql://user:pass@host/dbname

# Auth
JWT_SECRET=your-secret-key
ADMIN_JWT_SECRET=your-admin-secret

# Server
PORT=5000
NODE_ENV=development

# CORS (comma-separated origins)
CORS_ORIGIN=http://localhost:5173,https://yourdomain.com

# Mail engine
MAIL_ENGINE_URL=https://lsmailengine.onrender.com
MAIL_API_KEY=your-api-key

# AI (Groq)
GROQ_API_KEY=your-groq-api-key
```

### Database Migration

```bash
npm run migrate        # Run all migrations in order
```

Migration scripts are numbered by section and handle schema creation, indexes, and seed data. Run them in order on a fresh database.

---

## Security Notes

- **Helmet** is configured with `crossOriginResourcePolicy: "cross-origin"` — required for audio streaming across origins. CSP is intentionally disabled (handled at the CDN/edge level).
- **Rate limiting** is implemented but currently disabled — re-enable `express-rate-limit` for production hardening.
- **No raw SQL injection surface** — all queries use parameterized `pg` statements.
- **CORS wildcard exclusion** — `*.vercel.app` is permitted for preview deploys; all other origins must be explicitly allowlisted.

---

## Deployment

Designed for **Render** but compatible with Railway, Fly.io, or any platform that can run a Node.js process with environment secrets.

```bash
# Production start command
node src/server.js

# Build step: none required (no compilation)
```

The server sets `trust proxy: 1` automatically, which is required for correct `Secure` cookie behavior behind Render's reverse proxy.

---

## Author

Built by **[@next-coder21](https://github.com/next-coder21)** as the backend layer of the KK-lisn music streaming platform — a personal project to preserve and stream Kanyakumari VBS music from 2020–2024.

---

<div align="center">

*"For educational and portfolio reference only — see license notice above."*

</div>
