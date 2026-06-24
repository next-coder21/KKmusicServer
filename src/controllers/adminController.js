const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../models/User');
const { getRedis, isRedisAvailable } = require('../config/redis');
const { sendEmail } = require('../utils/email');
require('dotenv').config();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isValidUUID(v) { return UUID_RE.test(v); }

// ─── Ensure admin_users table exists + migrate missing columns ───────────────
const initAdminTable = async () => {
  try {
    // 1. Create table if it doesn't exist at all
    await pool.query(`
      CREATE TABLE IF NOT EXISTS admin_users (
        id         SERIAL PRIMARY KEY,
        email      VARCHAR(100) UNIQUE NOT NULL,
        password   VARCHAR(255) NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // 2. ADD any columns that may be missing in an older table
    const migrations = [
      `ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS name      VARCHAR(100) NOT NULL DEFAULT 'Admin'`,
      `ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS role      VARCHAR(20)  NOT NULL DEFAULT 'content_manager'`,
      `ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS is_active BOOLEAN      NOT NULL DEFAULT TRUE`,
    ];
    for (const sql of migrations) {
      await pool.query(sql).catch(() => {}); // ignore if already exists
    }

    // 3. Seed admin from env vars on first boot (skip if env is empty —
    //    the operator can create one manually via the admin endpoint).
    const { rows } = await pool.query('SELECT COUNT(*) FROM admin_users');
    if (parseInt(rows[0].count, 10) === 0) {
      const seedEmail = process.env.ADMIN_EMAIL;
      const seedPass  = process.env.ADMIN_PASSWORD;
      const seedName  = process.env.ADMIN_NAME || 'Super Admin';

      if (seedEmail && seedPass) {
        if (seedPass.length < 12) {
          console.warn('⚠ ADMIN_PASSWORD is weak (<12 chars). Use a stronger value in production.');
        }
        const hash = await bcrypt.hash(seedPass, 12);
        await pool.query(
          "INSERT INTO admin_users (email, password, name, role) VALUES ($1, $2, $3, $4)",
          [seedEmail, hash, seedName, 'super_admin']
        );
        console.log(`✅ Seeded initial admin: ${seedEmail}`);
      } else {
        console.warn(
          '⚠ admin_users is empty and ADMIN_EMAIL / ADMIN_PASSWORD are not set. ' +
          'No admin will be auto-created. Set both env vars to seed one.'
        );
      }
    }

    console.log('✅ admin_users table ready.');
  } catch (err) {
    console.error("Admin DB Init Error:", err.message);
  }
};
initAdminTable();

// ─── Migrate songs table for new columns ──────────────────────────────────────
const initSongsMigrations = async () => {
  const migrations = [
    `ALTER TABLE songs ADD COLUMN IF NOT EXISTS is_visible BOOLEAN NOT NULL DEFAULT TRUE`,
    `ALTER TABLE songs ADD COLUMN IF NOT EXISTS genre_id   INTEGER REFERENCES genres(id) ON DELETE SET NULL`,
    `ALTER TABLE songs ADD COLUMN IF NOT EXISTS lyrics     TEXT`,
  ];
  for (const sql of migrations) {
    await pool.query(sql).catch(() => {});
  }
};
initSongsMigrations();

// ─── Auth ─────────────────────────────────────────────────────────────────────
exports.login = async (req, res) => {
  const { email, password } = req.body;
  try {
    // Don't filter on is_active in SQL — column may not exist on older DBs
    const result = await pool.query('SELECT * FROM admin_users WHERE email = $1', [email]);
    if (result.rows.length === 0) return res.status(401).json({ error: "Invalid credentials" });

    const admin = result.rows[0];

    // Check is_active only if the column exists in the result
    if (admin.is_active === false) return res.status(403).json({ error: "Account disabled" });

    const valid = await bcrypt.compare(password, admin.password);
    if (!valid) return res.status(401).json({ error: "Invalid credentials" });

    const token = jwt.sign(
      { adminId: admin.id, isAdmin: true, name: admin.name },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    res.cookie("admin_token", token, {
      httpOnly: true,
      secure:   process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? "None" : "Lax",
      maxAge:   60 * 60 * 1000,
    });

    // Security alert — non-blocking, failure must never break login
    try {
      const loginTime = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'full', timeStyle: 'short' });
      const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'Unknown';
      const html = `
        <div style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
          <div style="background:#07070f;padding:28px 36px 20px;">
            <p style="margin:0 0 4px;font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.2em;color:#C8FF00;">KK Music · Muves</p>
            <h1 style="margin:0;font-size:22px;font-weight:900;color:#fff;letter-spacing:-.02em;">⚠ Admin Login Detected</h1>
          </div>
          <div style="padding:28px 36px;">
            <p style="margin:0 0 16px;font-size:15px;color:#111;">Hello <strong>${admin.name}</strong>,</p>
            <p style="margin:0 0 20px;font-size:14px;color:#444;line-height:1.6;">
              A successful login was made to your admin account. If this was you, no action is needed.
              If you did <strong>not</strong> log in, change your password immediately.
            </p>
            <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:24px;">
              <tr style="background:#f8f8fb;">
                <td style="padding:10px 14px;color:#777;font-weight:600;width:110px;">Account</td>
                <td style="padding:10px 14px;color:#111;">${admin.email}</td>
              </tr>
              <tr>
                <td style="padding:10px 14px;color:#777;font-weight:600;">Time</td>
                <td style="padding:10px 14px;color:#111;">${loginTime} IST</td>
              </tr>
              <tr style="background:#f8f8fb;">
                <td style="padding:10px 14px;color:#777;font-weight:600;">IP Address</td>
                <td style="padding:10px 14px;color:#111;">${ip}</td>
              </tr>
              <tr>
                <td style="padding:10px 14px;color:#777;font-weight:600;">Session</td>
                <td style="padding:10px 14px;color:#111;">Expires in 1 hour</td>
              </tr>
            </table>
            <p style="margin:0;font-size:12px;color:#999;">This is an automated security alert from Muves. Do not reply to this email.</p>
          </div>
        </div>
      `;
      await sendEmail(
        admin.email,
        '⚠ Security Alert — Admin Login Detected',
        `Admin login detected for ${admin.email} at ${loginTime} IST from IP ${ip}.`,
        html
      );
    } catch (emailErr) {
      console.error('Admin login alert email failed (non-fatal):', emailErr.message);
    }

    res.json({ message: "Admin login successful", token, admin: { id: admin.id, name: admin.name, email: admin.email, role: admin.role } });
  } catch (error) {
    console.error("Admin login error:", error);
    res.status(500).json({ error: "Login failed" });
  }
};

exports.logout = (req, res) => {
  res.clearCookie("admin_token", {
    httpOnly: true,
    secure:   process.env.NODE_ENV === "production",
    sameSite: process.env.NODE_ENV === "production" ? "None" : "Lax",
  });
  res.json({ message: "Logged out" });
};

exports.checkAuth = (req, res) => {
  res.json({ isAdmin: true, admin: { adminId: req.admin.adminId, name: req.admin.name } });
};

// ─── Dashboard stats ──────────────────────────────────────────────────────────
exports.getDashboardStats = async (req, res) => {
  try {
    const [
      users, songs, artists, albums, reports, plays, topSongs,
      genres, announcements, artistFollows, searches,
      adImpressions, listeningStats, userSessions, albumSongEntries,
      feedbackResult,
    ] = await Promise.all([
      pool.query('SELECT COUNT(*) FROM users'),
      pool.query('SELECT COUNT(*) FROM songs'),
      pool.query('SELECT COUNT(*) FROM artists'),
      pool.query('SELECT COUNT(*) FROM albums'),
      pool.query("SELECT COUNT(*) FROM content_reports WHERE status = 'pending'").catch(() => ({ rows: [{ count: 0 }] })),
      pool.query('SELECT COALESCE(SUM(play_count), 0) AS total FROM songs'),
      pool.query(`
        SELECT s.id, s.title, s.cover_url, s.play_count, a.name AS artist_name
        FROM songs s LEFT JOIN artists a ON s.artist_id = a.id
        ORDER BY s.play_count DESC NULLS LAST
        LIMIT 8
      `),
      pool.query('SELECT COUNT(*) FROM genres').catch(() => ({ rows: [{ count: 0 }] })),
      pool.query('SELECT COUNT(*) FROM announcements').catch(() => ({ rows: [{ count: 0 }] })),
      pool.query('SELECT COUNT(*) FROM artist_follows').catch(() => ({ rows: [{ count: 0 }] })),
      pool.query('SELECT COUNT(*) FROM search_history').catch(() => ({ rows: [{ count: 0 }] })),
      pool.query('SELECT COUNT(*) FROM ad_impressions').catch(() => ({ rows: [{ count: 0 }] })),
      pool.query('SELECT COALESCE(SUM(minutes_listened), 0) AS total FROM user_listening_stats').catch(() => ({ rows: [{ total: 0 }] })),
      pool.query('SELECT COUNT(*) FROM user_sessions').catch(() => ({ rows: [{ count: 0 }] })),
      pool.query('SELECT COUNT(*) FROM album_songs').catch(() => ({ rows: [{ count: 0 }] })),
      pool.query("SELECT COUNT(*) FROM user_feedback WHERE status='pending'").catch(() => ({ rows: [{ count: 0 }] })),
    ]);

    res.json({
      totalUsers:            parseInt(users.rows[0].count),
      totalSongs:            parseInt(songs.rows[0].count),
      totalArtists:          parseInt(artists.rows[0].count),
      totalAlbums:           parseInt(albums.rows[0].count),
      pendingReports:        parseInt(reports.rows[0].count),
      pendingFeedback:       parseInt(feedbackResult.rows[0].count),
      totalPlays:            parseInt(plays.rows[0].total),
      topSongs:              topSongs.rows,
      totalGenres:           parseInt(genres.rows[0].count),
      totalAnnouncements:    parseInt(announcements.rows[0].count),
      totalArtistFollows:    parseInt(artistFollows.rows[0].count),
      totalSearches:         parseInt(searches.rows[0].count),
      totalAdImpressions:    parseInt(adImpressions.rows[0].count),
      totalListeningMinutes: parseInt(listeningStats.rows[0].total),
      activeUserSessions:    parseInt(userSessions.rows[0].count),
      albumSongEntries:      parseInt(albumSongEntries.rows[0].count),
    });
  } catch (error) {
    console.error("Dashboard stats error:", error);
    res.status(500).json({ error: "Failed to fetch stats" });
  }
};

// ─── AI Insights (GROQ multi-model) ──────────────────────────────────────────
const GROQ_URL      = 'https://api.groq.com/openai/v1/chat/completions';
const AI_CACHE_KEY  = 'muves:ai_insights:cache';
const AI_CACHE_TTL  = 6 * 60 * 60;          // 6 hours in seconds
const RL_MAX        = 10;                     // max forced refreshes per hour
const RL_WINDOW     = 3600;                   // 1-hour sliding window (seconds)

// ── Redis helpers (fallback to no-cache if Redis is down) ──
async function redisGet(key) {
  if (!isRedisAvailable()) return null;
  try { return await getRedis().get(key); } catch { return null; }
}
async function redisSet(key, value, ttl) {
  if (!isRedisAvailable()) return;
  try { await getRedis().setex(key, ttl, value); } catch { /* non-fatal */ }
}
async function redisIncr(key, ttl) {
  if (!isRedisAvailable()) return null;
  try {
    const r = getRedis();
    const count = await r.incr(key);
    if (count === 1) await r.expire(key, ttl + 60);
    return count;
  } catch { return null; }
}

// ── GROQ call ──
async function groqCall(model, systemPrompt, userPrompt, maxTokens = 120) {
  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userPrompt },
      ],
      max_tokens: maxTokens,
      temperature: 0.3,
      response_format: { type: 'json_object' },
    }),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => res.statusText);
    throw new Error(`GROQ [${model}] ${res.status}: ${err}`);
  }
  const data = await res.json();
  return JSON.parse(data.choices[0].message.content);
}

// ── Rate-limit alert email ──
const ALERT_RECIPIENTS = ['lijishwilson@gmail.com', 'lijishdon@gmail.com'];

async function sendRateLimitAlert(count, windowLabel) {
  const html = `
    <div style="font-family:Inter,system-ui,sans-serif;max-width:560px;margin:0 auto;background:#0a0a12;border:1px solid #1e1e2e;border-radius:12px;overflow:hidden;">
      <div style="background:linear-gradient(135deg,#f97316,#ef4444);padding:20px 28px;">
        <h2 style="margin:0;color:#fff;font-size:16px;font-weight:700;letter-spacing:-0.02em;">
          ⚠ GROQ Rate Limit Exceeded — Muves Admin
        </h2>
      </div>
      <div style="padding:24px 28px;">
        <p style="margin:0 0 14px;font-size:14px;color:#d1d5db;line-height:1.6;">
          The AI Insights endpoint has been force-refreshed <strong style="color:#f97316;">${count} times</strong>
          in the current hour window (<strong style="color:#fff;">${windowLabel}</strong>),
          which exceeds the configured limit of <strong style="color:#fff;">${RL_MAX}</strong>.
        </p>
        <p style="margin:0 0 14px;font-size:14px;color:#d1d5db;line-height:1.6;">
          Further forced refreshes this hour will be blocked (cached data will still be served).
          The limit resets automatically at the top of the next hour.
        </p>
        <table style="width:100%;border-collapse:collapse;font-size:13px;background:#111120;border-radius:8px;overflow:hidden;">
          <tr><td style="padding:10px 14px;color:#6b7280;font-weight:600;width:130px;">Limit</td>
              <td style="padding:10px 14px;color:#fff;">${RL_MAX} forced refreshes / hour</td></tr>
          <tr style="background:#0d0d1a;"><td style="padding:10px 14px;color:#6b7280;font-weight:600;">Current count</td>
              <td style="padding:10px 14px;color:#f97316;font-weight:700;">${count}</td></tr>
          <tr><td style="padding:10px 14px;color:#6b7280;font-weight:600;">Window</td>
              <td style="padding:10px 14px;color:#fff;">${windowLabel}</td></tr>
          <tr style="background:#0d0d1a;"><td style="padding:10px 14px;color:#6b7280;font-weight:600;">Models at risk</td>
              <td style="padding:10px 14px;color:#fff;">llama-3.3-70b-versatile (1K RPD), llama-4-scout (1K RPD)</td></tr>
        </table>
        <p style="margin:16px 0 0;font-size:11px;color:#4b5563;">This is an automated alert from Muves. Do not reply.</p>
      </div>
    </div>
  `;
  const subject  = '⚠ Alert — GROQ AI Rate Limit Exceeded (Muves Admin)';
  const textBody = `GROQ rate limit exceeded: ${count}/${RL_MAX} forced refreshes in window ${windowLabel}.`;
  await Promise.allSettled(
    ALERT_RECIPIENTS.map((to) =>
      sendEmail(to, subject, textBody, html).catch((e) =>
        console.error(`[AI Insights] alert email to ${to} failed:`, e.message)
      )
    )
  );
}

exports.getAiInsights = async (req, res) => {
  try {
    const force = req.query.force === 'true';

    // ── Serve from Redis cache if not forcing ──
    if (!force) {
      const cached = await redisGet(AI_CACHE_KEY);
      if (cached) return res.json({ ...JSON.parse(cached), fromCache: true });
    }

    // ── Rate limiting on forced refreshes ──
    if (force) {
      const hourWindow = Math.floor(Date.now() / 1000 / RL_WINDOW);
      const rlKey      = `muves:ai_insights:rl:${hourWindow}`;
      const alertKey   = `muves:ai_insights:rl:alerted:${hourWindow}`;
      const count      = await redisIncr(rlKey, RL_WINDOW);

      if (count !== null && count > RL_MAX) {
        // Send alert email only once per window
        const alreadyAlerted = await redisGet(alertKey);
        if (!alreadyAlerted) {
          await redisSet(alertKey, '1', RL_WINDOW + 60);
          const windowLabel = new Date(hourWindow * RL_WINDOW * 1000)
            .toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false, day: 'numeric', month: 'short' });
          sendRateLimitAlert(count, windowLabel); // fire-and-forget
        }

        // Still serve cached data if available rather than a hard error
        const cached = await redisGet(AI_CACHE_KEY);
        if (cached) return res.status(429).json({ ...JSON.parse(cached), fromCache: true, rateLimited: true, retryAfter: RL_WINDOW - (Math.floor(Date.now() / 1000) % RL_WINDOW) });
        return res.status(429).json({ error: 'Rate limit exceeded. Try again next hour.', rateLimited: true });
      }
    }

    // ── Gather stats ──
    const [users, songs, artists, albums, reports, plays,
           genres, listeningStats, searches, adImpressions, artistFollows] = await Promise.all([
      pool.query('SELECT COUNT(*) FROM users'),
      pool.query('SELECT COUNT(*) FROM songs'),
      pool.query('SELECT COUNT(*) FROM artists'),
      pool.query('SELECT COUNT(*) FROM albums'),
      pool.query("SELECT COUNT(*) FROM content_reports WHERE status='pending'").catch(() => ({ rows: [{ count: 0 }] })),
      pool.query('SELECT COALESCE(SUM(play_count),0) AS total FROM songs'),
      pool.query('SELECT COUNT(*) FROM genres').catch(() => ({ rows: [{ count: 0 }] })),
      pool.query('SELECT COALESCE(SUM(minutes_listened),0) AS total FROM user_listening_stats').catch(() => ({ rows: [{ total: 0 }] })),
      pool.query('SELECT COUNT(*) FROM search_history').catch(() => ({ rows: [{ count: 0 }] })),
      pool.query('SELECT COUNT(*) FROM ad_impressions').catch(() => ({ rows: [{ count: 0 }] })),
      pool.query('SELECT COUNT(*) FROM artist_follows').catch(() => ({ rows: [{ count: 0 }] })),
    ]);

    const statsContext = JSON.stringify({
      totalUsers:            parseInt(users.rows[0].count),
      totalSongs:            parseInt(songs.rows[0].count),
      totalArtists:          parseInt(artists.rows[0].count),
      totalAlbums:           parseInt(albums.rows[0].count),
      pendingReports:        parseInt(reports.rows[0].count),
      totalStreams:          parseInt(plays.rows[0].total),
      totalGenres:           parseInt(genres.rows[0].count),
      totalListeningMinutes: parseInt(listeningStats.rows[0].total),
      totalSearches:         parseInt(searches.rows[0].count),
      totalAdImpressions:    parseInt(adImpressions.rows[0].count),
      totalArtistFollows:    parseInt(artistFollows.rows[0].count),
    });

    const sysBase = 'You are a concise music-platform analytics AI. Always respond with ONLY valid JSON, no markdown.';

    // ── Call multiple GROQ models in parallel ──
    const [health, growth, content, risk] = await Promise.allSettled([
      groqCall(
        'llama-3.3-70b-versatile',
        sysBase,
        `Platform stats: ${statsContext}. Return JSON: {"score":<0-100>,"label":"<Excellent|Good|Fair|Poor>","insight":"<max 35 words>"}`,
        120,
      ),
      groqCall(
        'llama-3.1-8b-instant',
        sysBase,
        `Platform stats: ${statsContext}. Return JSON: {"outlook":"<Bullish|Neutral|Bearish>","confidence":<0-100>,"reason":"<max 35 words>"}`,
        100,
      ),
      groqCall(
        'meta-llama/llama-4-scout-17b-16e-instruct',
        sysBase,
        `Platform stats: ${statsContext}. Return JSON: {"action":"<top content recommendation, max 35 words>","priority":"<High|Medium|Low>","category":"<Artists|Albums|Genres|Engagement|Ads>"}`,
        120,
      ),
      groqCall(
        'llama-3.1-8b-instant',
        sysBase,
        `Platform stats: ${statsContext}. Identify the single biggest risk or concern. Return JSON: {"severity":"<High|Medium|Low>","risk":"<max 35 words>","area":"<Content|Users|Revenue|Engagement|Reports>"}`,
        120,
      ),
    ]);

    const extract = (s) =>
      s.status === 'fulfilled' ? { ok: true, data: s.value } : { ok: false, error: s.reason?.message || 'Failed' };

    const payload = {
      health:  extract(health),
      growth:  extract(growth),
      content: extract(content),
      risk:    extract(risk),
      generatedAt: new Date().toISOString(),
      fromCache: false,
    };

    await redisSet(AI_CACHE_KEY, JSON.stringify(payload), AI_CACHE_TTL);
    res.json(payload);
  } catch (error) {
    console.error('AI insights error:', error);
    res.status(500).json({ error: 'Failed to generate AI insights' });
  }
};

// ─── Songs CRUD ───────────────────────────────────────────────────────────────
exports.getSongs = async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        s.id, s.title, s.cover_url, s.audiourl,
        s.duration_seconds, s.play_count, s.is_explicit, s.created_at,
        COALESCE(s.is_visible, TRUE)  AS is_visible,
        s.artist_id,  a.name          AS artist_name,
        s.album_id,   al.title        AS album_title,
        s.genre_id,   g.name          AS genre,
        (s.lyrics IS NOT NULL AND s.lyrics <> '') AS has_lyrics
      FROM songs s
      LEFT JOIN artists a  ON s.artist_id = a.id
      LEFT JOIN albums  al ON s.album_id  = al.id
      LEFT JOIN genres  g  ON s.genre_id  = g.id
      ORDER BY s.created_at DESC
    `);
    res.json(rows);
  } catch (e) {
    // Fallback: lyrics/genre columns may not exist yet — run without them
    try {
      const { rows } = await pool.query(`
        SELECT s.id, s.title, s.cover_url, s.audiourl,
               s.duration_seconds, s.play_count, s.is_explicit, s.created_at,
               COALESCE(s.is_visible, TRUE) AS is_visible,
               FALSE AS has_lyrics,
               s.artist_id, a.name AS artist_name,
               s.album_id,  al.title AS album_title,
               NULL::integer AS genre_id, NULL::text AS genre
        FROM songs s
        LEFT JOIN artists a  ON s.artist_id = a.id
        LEFT JOIN albums  al ON s.album_id  = al.id
        ORDER BY s.created_at DESC
      `);
      res.json(rows);
    } catch (e2) { res.status(500).json({ error: e2.message }); }
  }
};

exports.addSong = async (req, res) => {
  try {
    const { title, artist_id, album_id, audiourl, cover_url, duration_seconds, is_explicit, genre_id, is_visible, track_number } = req.body;
    const { rows } = await pool.query(
      `INSERT INTO songs (title, artist_id, album_id, audiourl, cover_url, duration_seconds, is_explicit, genre_id, is_visible)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [title, artist_id || null, album_id || null, audiourl, cover_url || null,
       parseInt(duration_seconds) || 0, !!is_explicit, genre_id || null, is_visible !== false]
    );
    const song = rows[0];

    // Sync to album_songs track listing
    if (album_id && song.id) {
      const tn = track_number ? parseInt(track_number) : null;
      if (!tn) {
        // Auto-assign next track number
        const { rows: last } = await pool.query(
          'SELECT COALESCE(MAX(track_number), 0) + 1 AS next FROM album_songs WHERE album_id=$1', [album_id]
        );
        await pool.query(
          'INSERT INTO album_songs (album_id, song_id, track_number) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
          [album_id, song.id, last[0].next]
        ).catch(() => {});
      } else {
        await pool.query(
          'INSERT INTO album_songs (album_id, song_id, track_number) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
          [album_id, song.id, tn]
        ).catch(() => {});
      }
    }

    res.json(song);
  } catch (e) { res.status(500).json({ error: e.message }); }
};

exports.deleteSong = async (req, res) => {
  if (!isValidUUID(req.params.id)) return res.status(400).json({ error: "Invalid song ID" });
  try {
    await pool.query('DELETE FROM songs WHERE id = $1', [req.params.id]);
    res.json({ message: "Song deleted" });
  } catch (e) { res.status(500).json({ error: e.message }); }
};

// PATCH /admin/songs/:id — update any subset of fields (used for album/artist mapping)
exports.updateSong = async (req, res) => {
  if (!isValidUUID(req.params.id)) return res.status(400).json({ error: "Invalid song ID" });
  try {
    const { id } = req.params;
    const allowed = ['title','cover_url','audiourl','duration_seconds','artist_id','album_id','is_explicit','lyrics','genre_id','is_visible'];
    const fields = Object.keys(req.body).filter(k => allowed.includes(k));

    if (fields.length === 0)
      return res.status(400).json({ error: "No valid fields to update" });

    // Build parameterised SET clause
    const sets   = fields.map((f, i) => `${f} = $${i + 1}`).join(', ');
    const values = fields.map(f => req.body[f] === '' ? null : req.body[f]);
    values.push(id);

    const { rows } = await pool.query(
      `UPDATE songs SET ${sets}, updated_at = NOW() WHERE id = $${values.length} RETURNING *`,
      values
    ).catch(async () => {
      // updated_at may not exist — retry without it
      return pool.query(
        `UPDATE songs SET ${sets} WHERE id = $${values.length} RETURNING *`,
        values
      );
    });

    if (!rows.length) return res.status(404).json({ error: "Song not found" });
    res.json(rows[0]);
  } catch (e) {
    console.error("updateSong error:", e.message);
    res.status(500).json({ error: e.message });
  }
};

// ─── Genres (read-only) ───────────────────────────────────────────────────────
exports.getGenres = async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT id, name FROM genres ORDER BY name ASC`);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
};

// ─── Artists CRUD ─────────────────────────────────────────────────────────────
exports.getArtists = async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT a.*,
        (SELECT COUNT(*) FROM songs s WHERE s.artist_id = a.id) AS song_count
      FROM artists a
      ORDER BY a.name ASC
      LIMIT 200
    `);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
};

exports.addArtist = async (req, res) => {
  try {
    const { name, bio, image_url } = req.body;
    const { rows } = await pool.query(
      'INSERT INTO artists (name, bio, image_url) VALUES ($1, $2, $3) RETURNING *',
      [name, bio || null, image_url || null]
    );
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
};

exports.deleteArtist = async (req, res) => {
  try {
    await pool.query('DELETE FROM artists WHERE id = $1', [req.params.id]);
    res.json({ message: "Artist deleted" });
  } catch (e) { res.status(500).json({ error: e.message }); }
};

exports.updateArtist = async (req, res) => {
  try {
    const { id } = req.params;
    const allowed = ['name', 'bio', 'image_url'];
    const fields = Object.keys(req.body).filter(k => allowed.includes(k));

    if (fields.length === 0) return res.status(400).json({ error: "No valid fields to update" });

    const sets = fields.map((f, i) => `${f} = $${i + 1}`).join(', ');
    const values = fields.map(f => req.body[f]);
    values.push(id);

    const { rows } = await pool.query(
      `UPDATE artists SET ${sets} WHERE id = $${values.length} RETURNING *`,
      values
    );

    if (!rows.length) return res.status(404).json({ error: "Artist not found" });
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
};

// ─── Albums CRUD ──────────────────────────────────────────────────────────────
exports.getAlbums = async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT al.*, a.name AS artist_name,
        (SELECT COUNT(*) FROM songs s WHERE s.album_id = al.id) AS song_count
      FROM albums al
      LEFT JOIN artists a ON al.artist_id = a.id
      ORDER BY al.title ASC
      LIMIT 200
    `);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
};

exports.addAlbum = async (req, res) => {
  try {
    const { title, artist_id, cover_url } = req.body;
    const { rows } = await pool.query(
      'INSERT INTO albums (title, artist_id, cover_url) VALUES ($1, $2, $3) RETURNING *',
      [title, artist_id || null, cover_url || null]
    );
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
};

exports.deleteAlbum = async (req, res) => {
  try {
    await pool.query('DELETE FROM albums WHERE id = $1', [req.params.id]);
    res.json({ message: "Album deleted" });
  } catch (e) { res.status(500).json({ error: e.message }); }
};

exports.updateAlbum = async (req, res) => {
  try {
    const { id } = req.params;
    const allowed = ['title', 'artist_id', 'cover_url'];
    const fields = Object.keys(req.body).filter(k => allowed.includes(k));

    if (fields.length === 0) return res.status(400).json({ error: "No valid fields to update" });

    const sets = fields.map((f, i) => `${f} = $${i + 1}`).join(', ');
    const values = fields.map(f => req.body[f] === '' ? null : req.body[f]);
    values.push(id);

    const { rows } = await pool.query(
      `UPDATE albums SET ${sets} WHERE id = $${values.length} RETURNING *`,
      values
    );

    if (!rows.length) return res.status(404).json({ error: "Album not found" });
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
};

// ─── Users CRUD ───────────────────────────────────────────────────────────────
exports.getUsers = async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        u.id, u.name, u.email, u.is_verified, u.is_active, u.created_at,
        COALESCE(ph.songs_played, 0) AS songs_played
      FROM users u
      LEFT JOIN (
        SELECT user_email, COUNT(*) AS songs_played
        FROM play_history
        GROUP BY user_email
      ) ph ON u.email = ph.user_email
      ORDER BY u.created_at DESC
      LIMIT 200
    `);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
};

exports.deleteUser = async (req, res) => {
  try {
    await pool.query('DELETE FROM users WHERE id = $1', [req.params.id]);
    res.json({ message: "User deleted" });
  } catch (e) { res.status(500).json({ error: e.message }); }
};

// ─── Reports ──────────────────────────────────────────────────────────────────
exports.getReports = async (req, res) => {
  try {
    const { status } = req.query;
    let query = 'SELECT * FROM content_reports';
    const params = [];
    if (status) { query += ' WHERE status = $1'; params.push(status); }
    query += ' ORDER BY created_at DESC LIMIT 100';
    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
};

exports.updateReport = async (req, res) => {
  try {
    const { status } = req.body;
    await pool.query('UPDATE content_reports SET status = $1 WHERE id = $2', [status, req.params.id]);
    res.json({ message: "Report updated" });
  } catch (e) { res.status(500).json({ error: e.message }); }
};

// ─── User Feedback ──────────────────────────────────────────────────────────
const FEEDBACK_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS user_feedback (
    id           SERIAL PRIMARY KEY,
    user_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
    user_email   VARCHAR(100) NOT NULL,
    user_name    VARCHAR(100),
    type         VARCHAR(20)  NOT NULL CHECK (type IN ('suggestion','bug_report','general')),
    subject      VARCHAR(200) NOT NULL,
    message      TEXT         NOT NULL,
    status       VARCHAR(15)  DEFAULT 'pending' CHECK (status IN ('pending','reviewed','resolved','dismissed')),
    admin_note   TEXT,
    reviewed_at  TIMESTAMP,
    created_at   TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_user_feedback_status ON user_feedback(status, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_user_feedback_user   ON user_feedback(user_id);
`;

exports.getFeedback = async (req, res) => {
  const { status, type } = req.query;
  try {
    await pool.query(FEEDBACK_TABLE_SQL);
    let q = 'SELECT * FROM user_feedback WHERE 1=1';
    const params = [];
    if (status) { params.push(status); q += ` AND status = $${params.length}`; }
    if (type)   { params.push(type);   q += ` AND type = $${params.length}`; }
    q += ' ORDER BY created_at DESC LIMIT 200';
    const { rows } = await pool.query(q, params);
    res.json(rows);
  } catch (err) {
    console.error('[getFeedback]', err.message);
    res.status(500).json({ error: 'Failed to fetch feedback' });
  }
};

exports.updateFeedback = async (req, res) => {
  const { status, admin_note } = req.body;
  const valid = ['pending','reviewed','resolved','dismissed'];
  if (!status || !valid.includes(status))
    return res.status(400).json({ error: 'Invalid status' });
  try {
    await pool.query(
      'UPDATE user_feedback SET status=$1, admin_note=$2, reviewed_at=NOW() WHERE id=$3',
      [status, admin_note || null, req.params.id]
    );
    res.json({ message: 'Feedback updated' });
  } catch (err) {
    console.error('[updateFeedback]', err.message);
    res.status(500).json({ error: 'Failed to update feedback' });
  }
};
