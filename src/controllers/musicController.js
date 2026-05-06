const pool  = require("../config/db");
const axios = require("axios");

// ─── Drive helpers ────────────────────────────────────────────────────────────
function extractDriveId(url) {
  const pats = [/\/d\/([a-zA-Z0-9_-]{10,})/, /[?&]id=([a-zA-Z0-9_-]{10,})/];
  for (const re of pats) { const m = url.match(re); if (m) return m[1]; }
  return null;
}

async function resolveDriveUrl(fileId) {
  const base = `https://drive.google.com/uc?export=download&id=${fileId}`;
  try {
    const check = await axios.get(base, { maxRedirects:5, validateStatus:()=>true, headers:{"User-Agent":"Mozilla/5.0"} });
    if (typeof check.data === "string" && check.data.includes("confirm=")) {
      const token = (check.data.match(/confirm=([0-9A-Za-z_-]+)/) || [])[1];
      if (token) return `https://drive.google.com/uc?export=download&confirm=${token}&id=${fileId}`;
    }
  } catch {}
  return base;
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
    const { rows } = await pool.query(`
      SELECT s.id, s.title, s.cover_url, s.audiourl,
             s.duration_seconds, s.is_explicit, s.play_count, s.created_at,
             a.name    AS artist_name, a.id   AS artist_id,
             al.title  AS album_title, al.id  AS album_id,
             g.name    AS genre
      FROM songs s
      LEFT JOIN artists a  ON s.artist_id = a.id
      LEFT JOIN albums  al ON s.album_id  = al.id
      LEFT JOIN genres  g  ON s.genre_id  = g.id
      WHERE s.is_visible IS NOT FALSE
      ORDER BY s.title ASC
    `);
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
  try {
    const { rows } = await pool.query(`
      SELECT s.id, s.title, s.cover_url, s.audiourl,
             s.duration_seconds, s.is_explicit, s.play_count, s.created_at,
             a.name    AS artist_name, a.id   AS artist_id, a.image_url AS artist_image,
             al.title  AS album_title, al.id  AS album_id,
             g.name    AS genre
      FROM songs s
      LEFT JOIN artists a  ON s.artist_id = a.id
      LEFT JOIN albums  al ON s.album_id  = al.id
      LEFT JOIN genres  g  ON s.genre_id  = g.id
      WHERE s.id = $1
    `, [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: "Song not found" });
    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch song" });
  }
};

// ─── GET songs by album ───────────────────────────────────────────────────────
exports.getSongsByAlbum = async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT s.id, s.title, s.cover_url, s.audiourl,
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
  try {
    const { id } = req.params;

    // Always ensure column exists before reading
    await ensureLyricsColumn();

    const { rows } = await pool.query("SELECT lyrics FROM songs WHERE id = $1", [id]);
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

// ─── Record play ──────────────────────────────────────────────────────────────
exports.recordPlay = async (req, res) => {
  try {
    const { id } = req.params;
    const email = req.user?.email;
    await pool.query("UPDATE songs SET play_count = COALESCE(play_count,0)+1 WHERE id=$1", [id]).catch(()=>{});
    if (email) {
      await pool.query("INSERT INTO play_history (user_email, song_id) VALUES ($1,$2)", [email, id]).catch(()=>{});
    }
    res.json({ ok: true });
  } catch { res.json({ ok: false }); }
};

// ─── Drive URL cache (in-process, keyed by fileId) ───────────────────────────
// Stores { url, size, expiresAt } so we never re-resolve the same Drive file
// within a 50-minute window (Google's confirm tokens last ~1 hour).
const driveCache = new Map();
const CACHE_TTL  = 50 * 60 * 1000; // 50 min in ms

async function resolveAndCacheDriveUrl(fileId) {
  const cached = driveCache.get(fileId);
  if (cached && Date.now() < cached.expiresAt) return cached;

  // Resolve the real download URL (handles confirm token for large files)
  const base = `https://drive.google.com/uc?export=download&id=${fileId}`;
  let finalUrl = base;
  let size = null;

  try {
    const check = await axios.get(base, {
      maxRedirects: 5, validateStatus: () => true,
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    if (typeof check.data === "string" && check.data.includes("confirm=")) {
      const token = (check.data.match(/confirm=([0-9A-Za-z_-]+)/) || [])[1];
      if (token) finalUrl = `${base}&confirm=${token}`;
    }
  } catch {}

  // Probe total size once, cache alongside URL
  try {
    const head = await axios.head(finalUrl, {
      headers: { "User-Agent": "Mozilla/5.0" },
      maxRedirects: 5,
      validateStatus: () => true,
    });
    size = parseInt(head.headers["content-length"], 10) || null;
  } catch {}

  const entry = { url: finalUrl, size, expiresAt: Date.now() + CACHE_TTL };
  driveCache.set(fileId, entry);
  return entry;
}

// ─── Stream audio  (Spotify-style progressive chunked delivery) ───────────────
//
//  How it works:
//  1. Browser sends initial request (no Range header).
//     → We serve a 200 with Accept-Ranges and stream the whole file.
//     The <audio> element will immediately start buffering and playing.
//
//  2. Once the browser has played through the first few seconds it sends
//     Range requests automatically to fetch the rest. We honour them with 206.
//
//  3. The Drive URL (including confirm token) is cached for 50 min so
//     concurrent / sequential requests for the SAME song never re-resolve.
//
exports.streamAudio = async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT audiourl FROM songs WHERE id = $1", [req.params.id]
    );
    if (!rows.length || !rows[0].audiourl)
      return res.status(404).json({ error: "Audio not found" });

    // ── Resolve source URL ────────────────────────────────────────────────────
    let sourceUrl = rows[0].audiourl;
    let totalSize = null;

    const driveId = extractDriveId(sourceUrl);
    if (driveId) {
      const cached = await resolveAndCacheDriveUrl(driveId);
      sourceUrl = cached.url;
      totalSize = cached.size;
    } else {
      // Non-Drive URL — probe size on demand (no caching needed)
      try {
        const head = await axios.head(sourceUrl, {
          headers: { "User-Agent": "Mozilla/5.0" },
          maxRedirects: 5,
          validateStatus: () => true,
        });
        totalSize = parseInt(head.headers["content-length"], 10) || null;
      } catch {}
    }

    const rangeHeader = req.headers["range"];

    // ── No Range header → serve full stream (browser starts buffering) ────────
    if (!rangeHeader || !totalSize) {
      const upstream = await axios({
        method: "GET",
        url: sourceUrl,
        responseType: "stream",
        headers: { "User-Agent": "Mozilla/5.0" },
        maxRedirects: 5,
      });

      res.set({
        "Content-Type":  "audio/mpeg",
        "Accept-Ranges": "bytes",
        ...(totalSize && { "Content-Length": totalSize }),
        "Cache-Control": "public, max-age=3600",
        "X-Content-Type-Options": "nosniff",
      });

      upstream.data.on("error", () => { if (!res.headersSent) res.end(); });
      return upstream.data.pipe(res);
    }

    // ── Range request → serve the requested byte slice (206 Partial) ─────────
    const [startStr, endStr] = rangeHeader.replace("bytes=", "").split("-");
    const chunkStart = Math.max(0, parseInt(startStr, 10));
    const chunkEnd   = endStr
      ? Math.min(parseInt(endStr, 10), totalSize - 1)
      : totalSize - 1;

    if (chunkStart > chunkEnd)
      return res.status(416).set("Content-Range", `bytes */${totalSize}`).end();

    const chunkSize = chunkEnd - chunkStart + 1;

    const upstream = await axios({
      method: "GET",
      url: sourceUrl,
      responseType: "stream",
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Range": `bytes=${chunkStart}-${chunkEnd}`,
      },
      maxRedirects: 5,
    });

    res.status(206).set({
      "Content-Type":   "audio/mpeg",
      "Content-Range":  `bytes ${chunkStart}-${chunkEnd}/${totalSize}`,
      "Content-Length": chunkSize,
      "Accept-Ranges":  "bytes",
      "Cache-Control":  "public, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    });

    upstream.data.on("error", () => { if (!res.headersSent) res.end(); });
    upstream.data.pipe(res);

  } catch (error) {
    console.error("streamAudio error:", error.message);
    if (!res.headersSent) res.status(500).json({ error: "Failed to stream audio" });
  }
};

// ─── GET cover image (proxy) ──────────────────────────────────────────────────
// Proxies cover_url so Android's OS image loader (used by MediaSession /
// lock screen) can fetch it without needing auth or Drive confirmation flows.
exports.getCoverImage = async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT cover_url FROM songs WHERE id = $1", [req.params.id]
    );
    if (!rows.length || !rows[0].cover_url)
      return res.status(404).json({ error: "Cover not found" });

    let coverUrl = rows[0].cover_url;
    const driveId = extractDriveId(coverUrl);
    if (driveId) coverUrl = await resolveDriveUrl(driveId);

    const upstream = await axios({
      method: "GET",
      url: coverUrl,
      responseType: "stream",
      headers: { "User-Agent": "Mozilla/5.0" },
      maxRedirects: 5,
    });

    const ct = upstream.headers["content-type"] || "image/jpeg";
    res.setHeader("Content-Type", ct);
    res.setHeader("Cache-Control", "public, max-age=86400");
    upstream.data.pipe(res);
  } catch (error) {
    console.error("getCoverImage error:", error.message);
    if (!res.headersSent) res.status(500).json({ error: "Failed to proxy cover" });
  }
};
