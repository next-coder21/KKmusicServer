const pool         = require("../config/db");
const axios        = require("axios");
const { google }   = require("googleapis");

// ─── UUID validation ──────────────────────────────────────────────────────────
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isValidUUID(v) { return UUID_RE.test(v); }

// ─── Drive helpers ────────────────────────────────────────────────────────────
function extractDriveId(url) {
  const pats = [/\/d\/([a-zA-Z0-9_-]{10,})/, /[?&]id=([a-zA-Z0-9_-]{10,})/];
  for (const re of pats) { const m = url.match(re); if (m) return m[1]; }
  return null;
}

// Singleton OAuth2 client — reuses the same credentials as driveUpload.js
let _driveClient = null;
function getDriveClient() {
  if (_driveClient) return _driveClient;
  const oauth2 = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  oauth2.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  _driveClient = google.drive({ version: "v3", auth: oauth2 });
  return _driveClient;
}

// ─── LRC parser ───────────────────────────────────────────────────────────────
// Parses standard .lrc format:  [mm:ss.xx] lyric text
// Returns [{time: seconds, text: string}] sorted by time
function parseLRC(raw) {
  if (!raw || !raw.trim()) return null;
  const lines = raw.split("\n");
  const result = [];
  const tagRe  = /^\[(\d{1,2}):(\d{2})(?:[.:]\d+)?\]/;

  for (const line of lines) {
    const match = line.match(tagRe);
    if (!match) continue;
    const time = parseInt(match[1]) * 60 + parseFloat(match[2]);
    const text = line.replace(/^\[.*?\]/, "").trim();
    if (text) result.push({ time, text });
  }

  if (result.length === 0) {
    // Not LRC – return plain text lines
    const plain = raw.split("\n").map(l => l.trim()).filter(Boolean);
    return plain.length > 0 ? { type: "plain", lines: plain } : null;
  }

  result.sort((a, b) => a.time - b.time);
  return { type: "lrc", lines: result };
}

// ─── GET all songs ────────────────────────────────────────────────────────────
exports.getAllSongs = async (req, res) => {
  try {
    const { artist_id, album_id } = req.query;
    const conditions = ["s.is_visible IS NOT FALSE"];
    const params = [];

    if (artist_id) {
      params.push(artist_id);
      conditions.push(`s.artist_id = $${params.length}`);
    }
    if (album_id) {
      params.push(album_id);
      conditions.push(`s.album_id = $${params.length}`);
    }

    const whereClause = conditions.join(" AND ");

    const { rows } = await pool.query(`
      SELECT s.id, s.title, s.cover_url,
             s.duration_seconds, s.is_explicit, s.play_count, s.created_at,
             a.name    AS artist_name, a.id   AS artist_id,
             al.title  AS album_title, al.id  AS album_id,
             g.name    AS genre
      FROM songs s
      LEFT JOIN artists a  ON s.artist_id = a.id
      LEFT JOIN albums  al ON s.album_id  = al.id
      LEFT JOIN genres  g  ON s.genre_id  = g.id
      WHERE ${whereClause}
      ORDER BY s.title ASC
    `, params);
    res.json(rows);
  } catch (error) {
    console.error("getAllSongs:", error);
    res.status(500).json({ error: "Failed to fetch songs" });
  }
};

// ─── GET all albums ───────────────────────────────────────────────────────────
exports.getAllAlbums = async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT al.*, a.name AS artist_name,
        (SELECT COUNT(*) FROM songs s WHERE s.album_id = al.id) AS song_count
      FROM albums al
      LEFT JOIN artists a ON al.artist_id = a.id
      ORDER BY al.title ASC
    `);
    res.json(rows);
  } catch (error) {
    console.error("getAllAlbums:", error);
    res.status(500).json({ error: "Failed to fetch albums" });
  }
};

// ─── GET all artists ──────────────────────────────────────────────────────────
exports.getAllArtists = async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT a.*,
        (SELECT COUNT(*) FROM songs s WHERE s.artist_id = a.id) AS song_count
      FROM artists a
      ORDER BY a.name ASC
    `);
    res.json(rows);
  } catch (error) {
    console.error("getAllArtists:", error);
    res.status(500).json({ error: "Failed to fetch artists" });
  }
};

// ─── GET all genres ───────────────────────────────────────────────────────────
exports.getAllGenres = async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT g.*, 
        (SELECT COUNT(*) FROM songs s WHERE s.genre_id = g.id) AS song_count
      FROM genres g
      ORDER BY g.name ASC
    `);
    res.json(rows);
  } catch (error) {
    console.error("getAllGenres:", error);
    res.status(500).json({ error: "Failed to fetch genres" });
  }
};

// ─── GET song by id ───────────────────────────────────────────────────────────
exports.getSongById = async (req, res) => {
  if (!isValidUUID(req.params.id)) return res.status(400).json({ error: "Invalid song ID" });
  try {
    const { rows } = await pool.query(`
      SELECT s.id, s.title, s.cover_url,
             s.duration_seconds, s.is_explicit, s.play_count, s.created_at,
             a.name    AS artist_name, a.id   AS artist_id, a.image_url AS artist_image,
             al.title  AS album_title, al.id  AS album_id,
             g.name    AS genre
      FROM songs s
      LEFT JOIN artists a  ON s.artist_id = a.id
      LEFT JOIN albums  al ON s.album_id  = al.id
      LEFT JOIN genres  g  ON s.genre_id  = g.id
      WHERE s.id = $1 AND s.is_visible IS NOT FALSE
    `, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: "Song not found" });
    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch song" });
  }
};

// ─── GET songs by album ───────────────────────────────────────────────────────
exports.getSongsByAlbum = async (req, res) => {
  if (!isValidUUID(req.params.id)) return res.status(400).json({ error: "Invalid album ID" });
  try {
    const { rows } = await pool.query(`
      SELECT s.id, s.title, s.cover_url,
             s.duration_seconds, s.is_explicit, s.play_count,
             a.name AS artist_name, a.id AS artist_id,
             al.title AS album_title, al.id AS album_id, al.cover_url AS album_cover,
             g.name AS genre
      FROM songs s
      LEFT JOIN artists a  ON s.artist_id = a.id
      LEFT JOIN albums  al ON s.album_id  = al.id
      LEFT JOIN genres  g  ON s.genre_id  = g.id
      WHERE s.album_id = $1 AND s.is_visible IS NOT FALSE
      ORDER BY s.title ASC
    `, [req.params.id]);
    res.json(rows);
  } catch (error) {
    console.error("getSongsByAlbum:", error);
    res.status(500).json({ error: "Failed to fetch album songs" });
  }
};

// ─── Ensure lyrics column exists (called once, cached after) ─────────────────
let lyricsColumnReady = false;
async function ensureLyricsColumn() {
  if (lyricsColumnReady) return;
  await pool.query("ALTER TABLE songs ADD COLUMN IF NOT EXISTS lyrics TEXT");
  lyricsColumnReady = true;
}

// ─── GET lyrics ───────────────────────────────────────────────────────────────
exports.getLyrics = async (req, res) => {
  if (!isValidUUID(req.params.id)) return res.status(400).json({ error: "Invalid song ID" });
  try {
    const { id } = req.params;

    // Always ensure column exists before reading
    await ensureLyricsColumn();

    const { rows } = await pool.query("SELECT lyrics FROM songs WHERE id = $1 AND is_visible IS NOT FALSE", [id]);
    if (!rows.length) return res.status(404).json({ error: "Song not found" });

    const raw = rows[0].lyrics;
    if (!raw) return res.status(404).json({ error: "No lyrics for this song" });

    const parsed = parseLRC(raw);
    if (!parsed) return res.status(404).json({ error: "No lyrics for this song" });

    res.json({ ...parsed, raw });
  } catch (error) {
    console.error("getLyrics:", error);
    res.status(500).json({ error: "Failed to fetch lyrics" });
  }
};

// ─── SAVE lyrics ─────────────────────────────────────────────────────────────
exports.saveLyrics = async (req, res) => {
  if (!isValidUUID(req.params.id)) return res.status(400).json({ error: "Invalid song ID" });
  try {
    const { id } = req.params;
    const { lyrics } = req.body;

    await ensureLyricsColumn();
    await pool.query("UPDATE songs SET lyrics = $1 WHERE id = $2", [lyrics || null, id]);

    res.json({ ok: true });
  } catch (error) {
    console.error("saveLyrics:", error);
    res.status(500).json({ error: "Failed to save lyrics" });
  }
};

// ─── Public platform stats (no auth) ─────────────────────────────────────────
exports.platformStats = async (req, res) => {
  try {
    const [songs, artists, albums, plays, topSongs] = await Promise.all([
      pool.query("SELECT COUNT(*) FROM songs WHERE is_visible IS NOT FALSE"),
      pool.query("SELECT COUNT(*) FROM artists"),
      pool.query("SELECT COUNT(*) FROM albums"),
      pool.query("SELECT COALESCE(SUM(play_count),0) AS total FROM songs WHERE is_visible IS NOT FALSE"),
      pool.query(`
        SELECT s.id, s.title, s.cover_url, s.play_count,
               a.name AS artist_name
        FROM songs s
        LEFT JOIN artists a ON s.artist_id = a.id
        WHERE s.is_visible IS NOT FALSE AND s.play_count > 0
        ORDER BY s.play_count DESC NULLS LAST
        LIMIT 10
      `),
    ]);
    res.json({
      totalSongs:    parseInt(songs.rows[0].count),
      totalArtists:  parseInt(artists.rows[0].count),
      totalAlbums:   parseInt(albums.rows[0].count),
      totalPlays:    parseInt(plays.rows[0].total),
      topSongs:      topSongs.rows,
    });
  } catch (err) {
    console.error("platformStats:", err);
    res.status(500).json({ error: "Failed to fetch stats" });
  }
};

// ─── Record play ──────────────────────────────────────────────────────────────
exports.recordPlay = async (req, res) => {
  if (!isValidUUID(req.params.id)) return res.status(400).json({ error: "Invalid song ID" });
  try {
    const { id } = req.params;
    const email = req.user?.email;
    const visCheck = await pool.query("SELECT id FROM songs WHERE id=$1 AND is_visible IS NOT FALSE", [id]);
    if (!visCheck.rows.length) return res.status(404).json({ error: "Song not found" });
    await pool.query("UPDATE songs SET play_count = COALESCE(play_count,0)+1 WHERE id=$1", [id]).catch(()=>{});
    if (email) {
      await pool.query("INSERT INTO play_history (user_email, song_id) VALUES ($1,$2)", [email, id]).catch(()=>{});

      // Upsert daily listening stats
      const { rows } = await pool.query("SELECT duration_seconds FROM songs WHERE id=$1", [id]).catch(()=>({ rows: [] }));
      const mins = rows[0]?.duration_seconds ? rows[0].duration_seconds / 60 : 0;
      pool.query(`
        INSERT INTO user_listening_stats (user_email, stat_date, minutes_listened, songs_played)
        VALUES ($1, CURRENT_DATE, $2, 1)
        ON CONFLICT (user_email, stat_date) DO UPDATE SET
          minutes_listened = user_listening_stats.minutes_listened + $2,
          songs_played     = user_listening_stats.songs_played + 1
      `, [email, mins]).catch(() => {});
    }
    res.json({ ok: true });
  } catch { res.status(500).json({ ok: false }); }
};

// ─── Drive metadata cache (in-process, keyed by fileId) ──────────────────────
// Stores { mimeType, size, expiresAt }.  We don't cache a URL anymore — the
// Drive API streams directly, so there's no confirm-token URL to track.
// TTL is 55 min; googleapis refreshes the OAuth access token automatically.
const driveCache = new Map();
const CACHE_TTL  = 55 * 60 * 1000;

async function getDriveFileMeta(fileId) {
  const cached = driveCache.get(fileId);
  if (cached && Date.now() < cached.expiresAt) return cached;

  const drive = getDriveClient();
  const { data } = await drive.files.get({
    fileId,
    fields: "mimeType,size",
    supportsAllDrives: true,
  });

  const entry = {
    mimeType:  data.mimeType || "audio/mpeg",
    size:      data.size ? parseInt(data.size, 10) : null,
    expiresAt: Date.now() + CACHE_TTL,
  };
  driveCache.set(fileId, entry);
  return entry;
}

// ─── Stream audio ─────────────────────────────────────────────────────────────
//
//  Drive files  → streamed via googleapis (files.get alt=media) with OAuth,
//                 no confirm-token hacks, correct MIME type from Drive metadata.
//  Non-Drive    → proxied via axios as before (fallback for legacy URLs).
//
//  Range / 206 partial content is supported in both paths so seeking works.
//
exports.streamAudio = async (req, res) => {
  if (!isValidUUID(req.params.id)) return res.status(400).json({ error: "Invalid song ID" });
  try {
    const { rows } = await pool.query(
      "SELECT audiourl FROM songs WHERE id = $1 AND is_visible IS NOT FALSE", [req.params.id]
    );
    if (!rows.length || !rows[0].audiourl)
      return res.status(404).json({ error: "Audio not found" });

    const sourceUrl   = rows[0].audiourl;
    const rangeHeader = req.headers["range"];
    const driveId     = extractDriveId(sourceUrl);

    // ── Google Drive path (primary) ───────────────────────────────────────────
    if (driveId) {
      const { mimeType, size: totalSize } = await getDriveFileMeta(driveId);
      const drive = getDriveClient();

      // No Range or unknown size → full stream (200)
      if (!rangeHeader || !totalSize) {
        const { data: driveStream } = await drive.files.get(
          { fileId: driveId, alt: "media", supportsAllDrives: true },
          { responseType: "stream" }
        );

        res.set({
          "Content-Type":  mimeType,
          "Accept-Ranges": "bytes",
          ...(totalSize && { "Content-Length": totalSize }),
          "Cache-Control": "public, max-age=3600",
          "X-Content-Type-Options": "nosniff",
        });

        driveStream.on("error", () => { if (!res.headersSent) res.end(); });
        return driveStream.pipe(res);
      }

      // Range request → 206 Partial Content
      const [startStr, endStr] = rangeHeader.replace("bytes=", "").split("-");
      const chunkStart = Math.max(0, parseInt(startStr, 10));
      const chunkEnd   = endStr
        ? Math.min(parseInt(endStr, 10), totalSize - 1)
        : totalSize - 1;

      if (chunkStart > chunkEnd)
        return res.status(416).set("Content-Range", `bytes */${totalSize}`).end();

      const { data: driveStream } = await drive.files.get(
        { fileId: driveId, alt: "media", supportsAllDrives: true },
        {
          responseType: "stream",
          headers: { Range: `bytes=${chunkStart}-${chunkEnd}` },
        }
      );

      res.status(206).set({
        "Content-Type":   mimeType,
        "Content-Range":  `bytes ${chunkStart}-${chunkEnd}/${totalSize}`,
        "Content-Length": chunkEnd - chunkStart + 1,
        "Accept-Ranges":  "bytes",
        "Cache-Control":  "public, max-age=3600",
        "X-Content-Type-Options": "nosniff",
      });

      driveStream.on("error", () => { if (!res.headersSent) res.end(); });
      return driveStream.pipe(res);
    }

    // ── Non-Drive fallback (axios proxy) ──────────────────────────────────────
    let totalSize = null;
    try {
      const head = await axios.head(sourceUrl, {
        headers: { "User-Agent": "Mozilla/5.0" },
        maxRedirects: 5,
        validateStatus: () => true,
      });
      totalSize = parseInt(head.headers["content-length"], 10) || null;
    } catch {}

    if (!rangeHeader || !totalSize) {
      const upstream = await axios({
        method: "GET", url: sourceUrl, responseType: "stream",
        headers: { "User-Agent": "Mozilla/5.0" }, maxRedirects: 5,
      });
      res.set({
        "Content-Type":  upstream.headers["content-type"] || "audio/mpeg",
        "Accept-Ranges": "bytes",
        ...(totalSize && { "Content-Length": totalSize }),
        "Cache-Control": "public, max-age=3600",
        "X-Content-Type-Options": "nosniff",
      });
      upstream.data.on("error", () => { if (!res.headersSent) res.end(); });
      return upstream.data.pipe(res);
    }

    const [startStr, endStr] = rangeHeader.replace("bytes=", "").split("-");
    const chunkStart = Math.max(0, parseInt(startStr, 10));
    const chunkEnd   = endStr
      ? Math.min(parseInt(endStr, 10), totalSize - 1)
      : totalSize - 1;

    if (chunkStart > chunkEnd)
      return res.status(416).set("Content-Range", `bytes */${totalSize}`).end();

    const upstream = await axios({
      method: "GET", url: sourceUrl, responseType: "stream",
      headers: { "User-Agent": "Mozilla/5.0", "Range": `bytes=${chunkStart}-${chunkEnd}` },
      maxRedirects: 5,
    });

    res.status(206).set({
      "Content-Type":   upstream.headers["content-type"] || "audio/mpeg",
      "Content-Range":  `bytes ${chunkStart}-${chunkEnd}/${totalSize}`,
      "Content-Length": chunkEnd - chunkStart + 1,
      "Accept-Ranges":  "bytes",
      "Cache-Control":  "public, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    });
    upstream.data.on("error", () => { if (!res.headersSent) res.end(); });
    upstream.data.pipe(res);

  } catch (error) {
    const detail = error.response?.data?.error?.message
      || error.errors?.[0]?.message
      || error.message;
    const code = error.response?.status || error.code;
    console.error("streamAudio error:", { code, detail, stack: error.stack?.split("\n").slice(0, 3).join(" ") });
    if (!res.headersSent) res.status(500).json({ error: "Failed to stream audio", detail, code });
  }
};

// ─── GET cover image (proxy) ──────────────────────────────────────────────────
// Proxies cover_url so Android's OS image loader (used by MediaSession /
// lock screen) can fetch it without needing auth or Drive confirmation flows.
exports.getCoverImage = async (req, res) => {
  if (!isValidUUID(req.params.id)) return res.status(400).json({ error: "Invalid song ID" });
  try {
    const { rows } = await pool.query(
      "SELECT cover_url FROM songs WHERE id = $1 AND is_visible IS NOT FALSE", [req.params.id]
    );
    if (!rows.length || !rows[0].cover_url)
      return res.status(404).json({ error: "Cover not found" });

    const coverUrl = rows[0].cover_url;

    // Local server file — redirect, no proxy loop
    const serverBase = process.env.SERVER_URL || "https://api.lijishwilson.in/muves";
    if (coverUrl.startsWith(serverBase + "/covers/")) {
      return res.redirect(302, coverUrl);
    }

    const driveId  = extractDriveId(coverUrl);

    if (driveId) {
      const drive = getDriveClient();
      const { data: meta } = await drive.files.get({ fileId: driveId, fields: "mimeType", supportsAllDrives: true });
      const { data: imgStream } = await drive.files.get(
        { fileId: driveId, alt: "media", supportsAllDrives: true },
        { responseType: "stream" }
      );
      res.setHeader("Content-Type", meta.mimeType || "image/jpeg");
      res.setHeader("Cache-Control", "public, max-age=86400");
      imgStream.on("error", () => { if (!res.headersSent) res.end(); });
      return imgStream.pipe(res);
    }

    const upstream = await axios({
      method: "GET", url: coverUrl, responseType: "stream",
      headers: { "User-Agent": "Mozilla/5.0" }, maxRedirects: 5,
    });
    res.setHeader("Content-Type", upstream.headers["content-type"] || "image/jpeg");
    res.setHeader("Cache-Control", "public, max-age=86400");
    upstream.data.pipe(res);
  } catch (error) {
    console.error("getCoverImage error:", error.message);
    if (!res.headersSent) res.status(500).json({ error: "Failed to proxy cover" });
  }
};
