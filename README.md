# Muves Backend API

REST API for the Muves music streaming platform. Handles authentication, audio streaming, playlist management, admin operations, and user feedback.

**Production:** `https://api.lijishwilson.in/muves/`  
**Version:** `v0.1.0-beta.1`  
**Runtime:** Node.js 18 + Express 4 + PostgreSQL

---

## Stack

| Layer | Tech |
|---|---|
| Runtime | Node.js ≥ 18 |
| Framework | Express 4.21 |
| Database | PostgreSQL via `pg` |
| Auth | JWT (7-day user / 24-hour admin) + HttpOnly cookies |
| Storage | Google Drive (audio files, server-side token resolution) |
| AI | Groq (lyric generation) + Gemini |
| Process manager | PM2 |
| Reverse proxy | Nginx + Let's Encrypt (SSL) |

---

## Local Development

```bash
cp .env.example .env        # fill in values
npm install
npm run dev                 # node --watch src/server.js
```

Server starts on `http://localhost:5000`.

---

## Environment Variables

| Key | Description |
|---|---|
| `NODE_ENV` | `development` or `production` |
| `PORT` | Server port (default `5000`) |
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | Secret for signing user JWTs |
| `CORS_ORIGIN` | Allowed frontend origin |
| `ADMIN_EMAIL` | Seed admin account email |
| `ADMIN_PASSWORD` | Seed admin account password |
| `ADMIN_NAME` | Seed admin display name |
| `MAIL_ENGINE_URL` | Internal mail service URL |
| `MAIL_API_KEY` | Mail service API key |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret |
| `GOOGLE_REFRESH_TOKEN` | Google OAuth refresh token |
| `GOOGLE_DRIVE_AUDIO_FOLDER_ID` | Drive folder for audio uploads |
| `GROQ_API_KEY` | Groq API key (lyric generation) |
| `GEMINI_API_KEY` | Gemini API key |

> **Never commit `.env` to git.** It is in `.gitignore`.

---

## API Reference

### Auth (`/auth`)

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/auth/signup` | — | Register new user |
| POST | `/auth/login` | — | Login, returns JWT |
| POST | `/auth/logout` | User | Logout, clears cookie |
| GET | `/auth/check-auth` | User | Validate session |
| POST | `/auth/update-account` | User | Update name / avatar |
| DELETE | `/auth/account` | User | Delete account |
| POST | `/auth/forgot-password` | — | Send reset code |
| POST | `/auth/verify-reset-code` | — | Verify email code |
| POST | `/auth/reset-password` | — | Set new password |
| POST | `/auth/feedback` | User | Submit report / suggestion |

### Music (`/auth/music`)

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/auth/music` | User | List all songs |
| GET | `/auth/music/stream/:id` | User | Stream audio (server-side Drive proxy) |
| GET | `/auth/music/:id/lyrics` | User | Get song lyrics |
| POST | `/auth/music/:id/lyrics` | Admin | Save lyrics |

### Playlists, Favourites, Queue

Standard CRUD under `/auth/playlists`, `/auth/favourites`, `/auth/queue`.

### Admin (`/admin`) — Admin JWT required

| Method | Path | Description |
|---|---|---|
| GET | `/admin/dashboard` | Stats + pending counts |
| GET/POST/PATCH/DELETE | `/admin/songs` | Song management |
| GET/POST/PATCH/DELETE | `/admin/artists` | Artist management |
| GET/POST/PATCH/DELETE | `/admin/albums` | Album management |
| GET/PATCH | `/admin/reports` | Content reports |
| GET/PATCH | `/admin/feedback` | User feedback / suggestions |
| GET/PATCH/DELETE | `/admin/users` | User management |
| GET/POST/PATCH/DELETE | `/admin/announcements` | In-app announcements |
| GET/POST/PATCH/DELETE | `/admin/ads` | Ad management |
| POST | `/admin/lyricgen` | AI lyric generation |

---

## Audio Streaming

Audio is **never** served directly from Google Drive URLs. Every stream request goes through `/auth/music/stream/:id`, which:

1. Validates the user JWT
2. Resolves the Drive file ID server-side
3. Fetches a short-lived token from Google
4. Proxies the audio bytes to the client

---

## Production Deploy

The server runs on `lijish-server` managed by PM2.

```bash
# SSH in
ssh administrator@38.247.141.192

# Deploy updated files, then:
cd /var/www/html/muves-backend
pm2 restart muves-backend

# Check status
pm2 list
pm2 logs muves-backend --lines 20
```

### Versioning

```bash
git add -A
git commit -m "feat: <description>"
git tag v0.1.x-beta.x
pm2 restart muves-backend
```

Current release: **v0.1.0-beta.1**

---

## Project Structure

```
src/
├── server.js                   # Entry point
├── app.js                      # Express app setup
├── config/
│   └── db.js                   # PostgreSQL pool
├── controllers/                # Route handlers
├── middleware/
│   ├── authMiddleware.js       # User JWT guard
│   └── adminAuthMiddleware.js  # Admin JWT guard
├── models/                     # DB query helpers
├── routes/                     # Express routers
├── scripts/                    # DB init & migrations
└── utils/                      # Drive upload, email helpers
```

---

## Security

- Passwords hashed with `bcryptjs`
- All protected routes enforce JWT middleware — no bypass
- `.env` is `chmod 600`, owned by the deploy user
- `helmet` sets security headers on every response
- Rate limiting on auth endpoints via `express-rate-limit`
- Input validated on all write endpoints
- CORS locked to `CORS_ORIGIN` env value
