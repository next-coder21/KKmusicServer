const pool = require('../config/db');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isValidUUID(v) { return UUID_RE.test(v); }

const getEmail = req => req.user?.email;

// ─── Ensure play_history table exists ────────────────────────────────────────
(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS play_history (
        id         SERIAL PRIMARY KEY,
        user_email VARCHAR(100) NOT NULL,
        song_id    UUID NOT NULL,
        played_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    // Add index for fast user lookups
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_play_history_user 
      ON play_history (user_email, played_at DESC)
    `).catch(() => {});
    console.log('✅ play_history table ready.');
  } catch (err) {
    console.error('❌ play_history table error:', err.message);
  }
})();


// ─── Stats ────────────────────────────────────────────────────────────────────
exports.getStats = async (req, res) => {
  try {
    const email = getEmail(req);
    if (!email) return res.status(401).json({ error:"Unauthorized" });
    const [listens, playlists, time, favourites] = await Promise.all([
      pool.query('SELECT COUNT(*) FROM play_history WHERE user_email=$1', [email]),
      pool.query('SELECT COUNT(*) FROM playlists WHERE user_email=$1', [email]).catch(()=>({rows:[{count:0}]})),
      pool.query(`SELECT COALESCE(SUM(s.duration_seconds),0) AS total_seconds FROM play_history ph JOIN songs s ON ph.song_id=s.id WHERE ph.user_email=$1 AND s.is_visible IS NOT FALSE`, [email]),
      pool.query('SELECT COUNT(*) FROM favourites WHERE user_email=$1', [email]).catch(()=>({rows:[{count:0}]})),
    ]);
    res.json({
      total_listens:      parseInt(listens.rows[0].count)||0,
      playlists_count:    parseInt(playlists.rows[0].count)||0,
      listening_time_hrs: Math.round(parseInt(time.rows[0].total_seconds)/3600)||0,
      favourites_count:   parseInt(favourites.rows[0].count)||0,
    });
  } catch (err) { console.error("getStats error:", err); res.status(500).json({ error:"Failed to fetch stats" }); }
};

// ─── Play History ─────────────────────────────────────────────────────────────
exports.getPlayHistory = async (req, res) => {
  try {
    const email = getEmail(req);
    if (!email) return res.status(401).json({ error:"Unauthorized" });
    const r = await pool.query(`
      SELECT s.id,s.title,a.name AS artist_name,s.cover_url,s.duration_seconds,ph.played_at
      FROM play_history ph
      JOIN songs s ON ph.song_id=s.id
      LEFT JOIN artists a ON s.artist_id=a.id
      WHERE ph.user_email=$1 AND s.is_visible IS NOT FALSE
      ORDER BY ph.played_at DESC LIMIT 20
    `, [email]);
    res.json(r.rows);
  } catch (err) { console.error("getPlayHistory error:", err); res.status(500).json({ error:"Failed to fetch history" }); }
};

exports.clearPlayHistory = async (req, res) => {
  try {
    const email = getEmail(req);
    if (!email) return res.status(401).json({ error:"Unauthorized" });
    await pool.query('DELETE FROM play_history WHERE user_email=$1', [email]);
    res.json({ success: true, message: "History cleared" });
  } catch (err) { console.error("clearPlayHistory error:", err); res.status(500).json({ error: "Failed to clear history" }); }
};

// ─── GET user top genres ──────────────────────────────────────────────────────
exports.getUserTopGenres = async (req, res) => {
  try {
    const email = getEmail(req);
    if (!email) return res.status(401).json({ error: "Unauthorized" });

    const r = await pool.query(`
      SELECT g.id, g.name, COUNT(ph.id) as play_count
      FROM play_history ph
      JOIN songs s   ON ph.song_id = s.id
      JOIN genres g  ON s.genre_id = g.id
      WHERE ph.user_email = $1 AND s.is_visible IS NOT FALSE
      GROUP BY g.id, g.name
      ORDER BY play_count DESC
      LIMIT 10
    `, [email]);
    res.json(r.rows);
  } catch (error) {
    console.error("getUserTopGenres:", error);
    res.status(500).json({ error: "Failed to fetch top genres" });
  }
};

// ─── Search ───────────────────────────────────────────────────────────────────
exports.search = async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || !q.trim()) return res.json({ songs: [], artists: [], albums: [] });
    if (q.trim().length > 100) return res.status(400).json({ error: "Search query too long" });
    const p = `%${q.trim()}%`;
    const email = getEmail(req);
    const [songs, artists, albums] = await Promise.all([
      pool.query(`SELECT s.id,s.title,s.cover_url,s.duration_seconds,s.play_count,a.name AS artist_name,al.title AS album_title FROM songs s LEFT JOIN artists a ON s.artist_id=a.id LEFT JOIN albums al ON s.album_id=al.id WHERE (s.title ILIKE $1 OR a.name ILIKE $1) AND s.is_visible IS NOT FALSE ORDER BY s.play_count DESC NULLS LAST LIMIT 20`, [p]),
      pool.query(`SELECT id,name,image_url,(SELECT COUNT(*) FROM songs WHERE artist_id=artists.id) AS song_count FROM artists WHERE name ILIKE $1 LIMIT 8`, [p]),
      pool.query(`SELECT al.id,al.title,al.cover_url,a.name AS artist_name FROM albums al LEFT JOIN artists a ON al.artist_id=a.id WHERE al.title ILIKE $1 LIMIT 8`, [p]),
    ]);
    // Save search history (non-blocking)
    if (email) {
      pool.query(
        'INSERT INTO search_history (user_email, query) VALUES ($1, $2)',
        [email, q.trim()]
      ).catch(() => {});
    }
    res.json({ songs:songs.rows, artists:artists.rows, albums:albums.rows });
  } catch (err) { console.error("search error:", err); res.status(500).json({ error:"Search failed" }); }
};

// ─── Playlists ────────────────────────────────────────────────────────────────
exports.getPlaylists = async (req, res) => {
  try {
    const email = getEmail(req);
    if (!email) return res.status(401).json({ error:"Unauthorized" });
    const r = await pool.query(`
      SELECT p.id, p.name, p.is_public AS "isShared",
        COUNT(ps.song_id) FILTER (WHERE s.is_visible IS NOT FALSE) AS "songCount"
      FROM playlists p
      LEFT JOIN playlist_songs ps ON p.id = ps.playlist_id
      LEFT JOIN songs s ON ps.song_id = s.id
      WHERE p.user_email = $1
      GROUP BY p.id
      HAVING COUNT(ps.song_id) = 0
          OR COUNT(ps.song_id) FILTER (WHERE s.is_visible IS NOT FALSE) > 0
      ORDER BY p.created_at DESC
    `, [email]).catch(()=>({ rows:[] }));
    res.json(r.rows);
  } catch (err) { console.error("getPlaylists error:", err); res.status(500).json({ error:"Failed to fetch playlists" }); }
};

exports.createPlaylist = async (req, res) => {
  try {
    const email = getEmail(req);
    if (!email) return res.status(401).json({ error:"Unauthorized" });
    const { name } = req.body;
    if (!name?.trim()) return res.status(400).json({ error:"Name required" });
    // Auto-create playlists table if missing
    await pool.query(`
      CREATE TABLE IF NOT EXISTS playlists (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_email VARCHAR(100) NOT NULL REFERENCES users(email) ON DELETE CASCADE,
        name VARCHAR(200) NOT NULL,
        is_public BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `).catch(()=>{});
    const r = await pool.query(
      'INSERT INTO playlists (user_email,name) VALUES ($1,$2) RETURNING id,name,is_public AS "isShared",0 AS "songCount"',
      [email, name.trim()]
    );
    res.json(r.rows[0]);
  } catch (err) { console.error("createPlaylist error:", err); res.status(500).json({ error:"Failed to create playlist" }); }
};

exports.updatePlaylist = async (req, res) => {
  try {
    const email = getEmail(req);
    const { id } = req.params;
    if (!isValidUUID(id)) return res.status(400).json({ error: "Invalid playlist ID" });
    const { name, is_public } = req.body;
    const sets = [], vals = [];
    if (name !== undefined)      { sets.push(`name=$${vals.length+1}`);      vals.push(name); }
    if (is_public !== undefined) { sets.push(`is_public=$${vals.length+1}`); vals.push(is_public); }
    if (!sets.length) return res.status(400).json({ error:"Nothing to update" });
    vals.push(id); vals.push(email);
    await pool.query(
      `UPDATE playlists SET ${sets.join(',')} WHERE id=$${vals.length-1} AND user_email=$${vals.length}`,
      vals
    );
    res.json({ ok:true });
  } catch (err) { console.error("updatePlaylist error:", err); res.status(500).json({ error:"Failed to update playlist" }); }
};

exports.deletePlaylist = async (req, res) => {
  try {
    const email = getEmail(req);
    const { id } = req.params;
    if (!isValidUUID(id)) return res.status(400).json({ error: "Invalid playlist ID" });
    await pool.query('DELETE FROM playlists WHERE id=$1 AND user_email=$2', [id, email]);
    res.json({ message:"Playlist deleted" });
  } catch (err) { console.error("deletePlaylist error:", err); res.status(500).json({ error:"Failed to delete playlist" }); }
};

// ─── Playlist Songs ───────────────────────────────────────────────────────────
exports.getPlaylistSongs = async (req, res) => {
  try {
    const email = getEmail(req);
    if (!email) return res.status(401).json({ error: "Unauthorized" });
    const { id } = req.params;
    if (!isValidUUID(id)) return res.status(400).json({ error: "Invalid playlist ID" });
    const own = await pool.query('SELECT id FROM playlists WHERE id=$1 AND user_email=$2', [id, email]);
    if (!own.rows.length) return res.status(404).json({ error: "Playlist not found" });
    const r = await pool.query(`
      SELECT s.id, s.title, s.cover_url, s.duration_seconds,
             a.name AS artist_name, al.title AS album_title,
             ps.position, ps.added_at
      FROM playlist_songs ps
      JOIN songs s ON ps.song_id = s.id
      LEFT JOIN artists a ON s.artist_id = a.id
      LEFT JOIN albums al ON s.album_id = al.id
      WHERE ps.playlist_id = $1 AND s.is_visible IS NOT FALSE
      ORDER BY ps.position ASC, ps.added_at ASC
    `, [id]);
    res.json(r.rows);
  } catch (err) { console.error("getPlaylistSongs error:", err); res.status(500).json({ error: "Failed to fetch playlist songs" }); }
};

exports.addPlaylistSong = async (req, res) => {
  try {
    const email = getEmail(req);
    if (!email) return res.status(401).json({ error: "Unauthorized" });
    const { id } = req.params;
    const { songId } = req.body;
    if (!songId) return res.status(400).json({ error: "songId required" });
    if (!isValidUUID(songId)) return res.status(400).json({ error: "Invalid song ID" });
    const own = await pool.query('SELECT id FROM playlists WHERE id=$1 AND user_email=$2', [id, email]);
    if (!own.rows.length) return res.status(404).json({ error: "Playlist not found" });
    const vis = await pool.query('SELECT id FROM songs WHERE id=$1 AND is_visible IS NOT FALSE', [songId]);
    if (!vis.rows.length) return res.status(404).json({ error: "Song not found" });
    await pool.query(
      `INSERT INTO playlist_songs (playlist_id, song_id, position)
       SELECT $1, $2, COALESCE(MAX(position), -1) + 1
       FROM playlist_songs
       WHERE playlist_id = $1
       ON CONFLICT (playlist_id, song_id) DO NOTHING`,
      [id, songId]
    );
    res.json({ ok: true });
  } catch (err) { console.error("addPlaylistSong error:", err); res.status(500).json({ error: "Failed to add song" }); }
};

exports.removePlaylistSong = async (req, res) => {
  try {
    const email = getEmail(req);
    if (!email) return res.status(401).json({ error: "Unauthorized" });
    const { id, songId } = req.params;
    if (!isValidUUID(id)) return res.status(400).json({ error: "Invalid playlist ID" });
    if (!isValidUUID(songId)) return res.status(400).json({ error: "Invalid song ID" });
    const own = await pool.query('SELECT id FROM playlists WHERE id=$1 AND user_email=$2', [id, email]);
    if (!own.rows.length) return res.status(404).json({ error: "Playlist not found" });
    await pool.query('DELETE FROM playlist_songs WHERE playlist_id=$1 AND song_id=$2', [id, songId]);
    res.json({ ok: true });
  } catch (err) { console.error("removePlaylistSong error:", err); res.status(500).json({ error: "Failed to remove song" }); }
};

// ─── Sessions ─────────────────────────────────────────────────────────────────
exports.getSessions = async (req, res) => {
  try {
    const email = getEmail(req);
    if (!email) return res.status(401).json({ error: "Unauthorized" });
    const { rows } = await pool.query(
      'SELECT id, device_type, device_name, ip_address, user_agent, last_active, created_at FROM user_sessions WHERE user_email=$1 ORDER BY last_active DESC LIMIT 10',
      [email]
    );
    res.json(rows);
  } catch (err) { console.error("getSessions error:", err); res.status(500).json({ error: "Failed to fetch sessions" }); }
};

exports.deleteSession = async (req, res) => {
  const email = getEmail(req);
  if (!email) return res.status(401).json({ error: "Unauthorized" });
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM user_sessions WHERE id=$1 AND user_email=$2', [id, email]);
    res.json({ ok: true });
  } catch (err) { console.error("deleteSession error:", err); res.status(500).json({ error: "Failed to delete session" }); }
};

// ─── Artist Follows ───────────────────────────────────────────────────────────
exports.followArtist = async (req, res) => {
  try {
    const email = getEmail(req);
    if (!email) return res.status(401).json({ error: "Unauthorized" });
    const { id } = req.params;
    if (!isValidUUID(id)) return res.status(400).json({ error: "Invalid artist ID" });
    await pool.query(
      'INSERT INTO artist_follows (user_email, artist_id) VALUES ($1, $2) ON CONFLICT (user_email, artist_id) DO NOTHING',
      [email, id]
    );
    res.json({ following: true });
  } catch (err) { console.error("followArtist error:", err); res.status(500).json({ error: "Failed to follow artist" }); }
};

exports.unfollowArtist = async (req, res) => {
  try {
    const email = getEmail(req);
    if (!email) return res.status(401).json({ error: "Unauthorized" });
    const { id } = req.params;
    if (!isValidUUID(id)) return res.status(400).json({ error: "Invalid artist ID" });
    await pool.query('DELETE FROM artist_follows WHERE user_email=$1 AND artist_id=$2', [email, id]);
    res.json({ following: false });
  } catch (err) { console.error("unfollowArtist error:", err); res.status(500).json({ error: "Failed to unfollow artist" }); }
};

exports.getFollowedArtists = async (req, res) => {
  try {
    const email = getEmail(req);
    if (!email) return res.status(401).json({ error: "Unauthorized" });
    const { rows } = await pool.query(`
      SELECT a.id, a.name, a.image_url,
        (SELECT COUNT(*) FROM songs WHERE artist_id = a.id) AS song_count,
        af.followed_at
      FROM artist_follows af
      JOIN artists a ON af.artist_id = a.id
      WHERE af.user_email = $1
      ORDER BY af.followed_at DESC
    `, [email]);
    res.json(rows);
  } catch (err) { console.error("getFollowedArtists error:", err); res.status(500).json({ error: "Failed to fetch followed artists" }); }
};

// ─── Notifications ────────────────────────────────────────────────────────────
exports.getNotifications = async (req, res) => {
  try {
    const email = getEmail(req);
    if (!email) return res.status(401).json({ error:"Unauthorized" });
    const r = await pool.query(
      'SELECT * FROM notifications WHERE user_email=$1 ORDER BY created_at DESC LIMIT 30', [email]
    ).catch(()=>({ rows:[] }));
    res.json(r.rows);
  } catch (err) { console.error("getNotifications error:", err); res.status(500).json({ error:"Failed to fetch notifications" }); }
};

exports.markNotificationRead = async (req, res) => {
  const email = getEmail(req);
  if (!email) return res.status(401).json({ error: "Unauthorized" });
  try {
    const { id } = req.params;
    await pool.query('UPDATE notifications SET is_read=TRUE WHERE id=$1 AND user_email=$2', [id, email]);
    res.json({ message:"Marked as read" });
  } catch (err) { console.error("markNotificationRead error:", err); res.status(500).json({ error:"Failed" }); }
};

exports.markAllNotificationsRead = async (req, res) => {
  const email = getEmail(req);
  if (!email) return res.status(401).json({ error: "Unauthorized" });
  try {
    await pool.query('UPDATE notifications SET is_read=TRUE WHERE user_email=$1', [email]);
    res.json({ message:"All marked as read" });
  } catch (err) { console.error("markAllNotificationsRead error:", err); res.status(500).json({ error:"Failed" }); }
};

// ─── Rate Song ────────────────────────────────────────────────────────────────
exports.rateSong = async (req, res) => {
  try {
    const email = getEmail(req);
    if (!email) return res.status(401).json({ error:"Unauthorized" });
    const { id:songId } = req.params;
    const { rating } = req.body;
    if (rating !== null && rating !== undefined && ![1, -1].includes(Number(rating)))
      return res.status(400).json({ error: "Rating must be 1 (like) or -1 (dislike)" });
    const vis = await pool.query('SELECT id FROM songs WHERE id=$1 AND is_visible IS NOT FALSE', [songId]);
    if (!vis.rows.length) return res.status(404).json({ error: "Song not found" });
    if (rating===null||rating===undefined) {
      await pool.query('DELETE FROM song_ratings WHERE user_email=$1 AND song_id=$2', [email,songId]).catch(()=>{});
    } else {
      await pool.query(`INSERT INTO song_ratings (user_email,song_id,rating) VALUES ($1,$2,$3) ON CONFLICT (user_email,song_id) DO UPDATE SET rating=$3`, [email,songId,rating]).catch(()=>{});
    }
    res.json({ message:"Rating saved" });
  } catch (err) { console.error("rateSong error:", err); res.status(500).json({ error:"Failed to rate song" }); }
};

// ─── Feedback / Suggestions ───────────────────────────────────────────────────
exports.submitFeedback = async (req, res) => {
  const { type, subject, message } = req.body;
  const userId = req.user?.id;
  const userEmail = req.user?.email;
  const userName = req.user?.name || null;

  if (!type || !['suggestion','bug_report','general'].includes(type))
    return res.status(400).json({ error: 'type must be suggestion, bug_report, or general' });
  if (!subject?.trim() || subject.trim().length < 3)
    return res.status(400).json({ error: 'subject is required (min 3 chars)' });
  if (!message?.trim() || message.trim().length < 10)
    return res.status(400).json({ error: 'message is required (min 10 chars)' });

  try {
    await pool.query(`
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
      )
    `);
    const { rows } = await pool.query(
      `INSERT INTO user_feedback (user_id, user_email, user_name, type, subject, message)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, created_at`,
      [userId || null, userEmail, userName, type, subject.trim(), message.trim()]
    );
    res.json({ id: rows[0].id, created_at: rows[0].created_at, message: 'Feedback submitted successfully' });
  } catch (err) {
    console.error('[submitFeedback]', err.message);
    res.status(500).json({ error: 'Failed to submit feedback' });
  }
};

// ─── Delete Account ───────────────────────────────────────────────────────────
exports.deleteAccount = async (req, res) => {
  const client = await pool.connect();
  try {
    const email = getEmail(req);
    if (!email) return res.status(401).json({ error:"Unauthorized" });
    await client.query('BEGIN');
    // Clean up all user data before deleting the user
    await client.query('DELETE FROM play_history    WHERE user_email=$1', [email]).catch(()=>{});
    await client.query('DELETE FROM favourites      WHERE user_email=$1', [email]).catch(()=>{});
    await client.query('DELETE FROM queue           WHERE user_email=$1', [email]).catch(()=>{});
    await client.query('DELETE FROM playlists       WHERE user_email=$1', [email]).catch(()=>{});
    await client.query('DELETE FROM notifications   WHERE user_email=$1', [email]).catch(()=>{});
    await client.query('DELETE FROM song_ratings    WHERE user_email=$1', [email]).catch(()=>{});
    await client.query('DELETE FROM user_profiles   WHERE email=$1',      [email]).catch(()=>{});
    await client.query('DELETE FROM users           WHERE email=$1',      [email]);
    await client.query('COMMIT');
    // Must pass the same options used when the cookie was set so the
    // browser/proxy actually clears it (secure + sameSite must match).
    const clearOpts = {
      httpOnly: true,
      secure:   process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? "None" : "Lax",
    };
    res.clearCookie("token", clearOpts);
    res.clearCookie("refresh_token", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: process.env.NODE_ENV === "production" ? "None" : "Lax" });
    res.json({ message:"Account deleted successfully" });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error("Delete account error:", e);
    res.status(500).json({ error:"Failed to delete account" });
  } finally { client.release(); }
};
