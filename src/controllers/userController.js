const pool = require('../models/User');

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
    const [listens, playlists, time] = await Promise.all([
      pool.query('SELECT COUNT(*) FROM play_history WHERE user_email=$1', [email]),
      pool.query('SELECT COUNT(*) FROM playlists WHERE user_email=$1', [email]).catch(()=>({rows:[{count:0}]})),
      pool.query(`SELECT COALESCE(SUM(s.duration_seconds),0) AS total_seconds FROM play_history ph JOIN songs s ON ph.song_id=s.id WHERE ph.user_email=$1`, [email]),
    ]);
    res.json({
      total_listens:      parseInt(listens.rows[0].count)||0,
      playlists_count:    parseInt(playlists.rows[0].count)||0,
      listening_time_hrs: Math.round(parseInt(time.rows[0].total_seconds)/3600)||0,
    });
  } catch (e) { res.status(500).json({ error:"Failed to fetch stats" }); }
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
      WHERE ph.user_email=$1
      ORDER BY ph.played_at DESC LIMIT 20
    `, [email]);
    res.json(r.rows);
  } catch { res.status(500).json({ error:"Failed to fetch history" }); }
};

exports.clearPlayHistory = async (req, res) => {
  try {
    const email = getEmail(req);
    if (!email) return res.status(401).json({ error:"Unauthorized" });
    await pool.query('DELETE FROM play_history WHERE user_email=$1', [email]);
    res.json({ success: true, message: "History cleared" });
  } catch { res.status(500).json({ error: "Failed to clear history" }); }
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
      WHERE ph.user_email = $1
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
    const [songs, artists, albums] = await Promise.all([
      pool.query(`SELECT s.id,s.title,s.cover_url,s.duration_seconds,s.play_count,a.name AS artist_name,al.title AS album_title FROM songs s LEFT JOIN artists a ON s.artist_id=a.id LEFT JOIN albums al ON s.album_id=al.id WHERE s.title ILIKE $1 OR a.name ILIKE $1 ORDER BY s.play_count DESC NULLS LAST LIMIT 20`, [p]),
      pool.query(`SELECT id,name,image_url,(SELECT COUNT(*) FROM songs WHERE artist_id=artists.id) AS song_count FROM artists WHERE name ILIKE $1 LIMIT 8`, [p]),
      pool.query(`SELECT al.id,al.title,al.cover_url,a.name AS artist_name FROM albums al LEFT JOIN artists a ON al.artist_id=a.id WHERE al.title ILIKE $1 LIMIT 8`, [p]),
    ]);
    res.json({ songs:songs.rows, artists:artists.rows, albums:albums.rows });
  } catch { res.status(500).json({ error:"Search failed" }); }
};

// ─── Playlists ────────────────────────────────────────────────────────────────
exports.getPlaylists = async (req, res) => {
  try {
    const email = getEmail(req);
    if (!email) return res.status(401).json({ error:"Unauthorized" });
    const r = await pool.query(`
      SELECT p.id,p.name,p.is_public AS "isShared",COALESCE(COUNT(ps.song_id),0) AS "songCount"
      FROM playlists p
      LEFT JOIN playlist_songs ps ON p.id=ps.playlist_id
      WHERE p.user_email=$1
      GROUP BY p.id ORDER BY p.created_at DESC
    `, [email]).catch(()=>({ rows:[] }));
    res.json(r.rows);
  } catch { res.status(500).json({ error:"Failed to fetch playlists" }); }
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
  } catch (e) { res.status(500).json({ error:"Failed to create playlist" }); }
};

exports.updatePlaylist = async (req, res) => {
  try {
    const email = getEmail(req);
    const { id } = req.params;
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
  } catch { res.status(500).json({ error:"Failed to update playlist" }); }
};

exports.deletePlaylist = async (req, res) => {
  try {
    const email = getEmail(req);
    const { id } = req.params;
    await pool.query('DELETE FROM playlists WHERE id=$1 AND user_email=$2', [id, email]);
    res.json({ message:"Playlist deleted" });
  } catch { res.status(500).json({ error:"Failed to delete playlist" }); }
};

// ─── Playlist Songs ───────────────────────────────────────────────────────────
exports.getPlaylistSongs = async (req, res) => {
  try {
    const email = getEmail(req);
    if (!email) return res.status(401).json({ error: "Unauthorized" });
    const { id } = req.params;
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
      WHERE ps.playlist_id = $1
      ORDER BY ps.position ASC, ps.added_at ASC
    `, [id]);
    res.json(r.rows);
  } catch { res.status(500).json({ error: "Failed to fetch playlist songs" }); }
};

exports.addPlaylistSong = async (req, res) => {
  try {
    const email = getEmail(req);
    if (!email) return res.status(401).json({ error: "Unauthorized" });
    const { id } = req.params;
    const { songId } = req.body;
    if (!songId) return res.status(400).json({ error: "songId required" });
    const own = await pool.query('SELECT id FROM playlists WHERE id=$1 AND user_email=$2', [id, email]);
    if (!own.rows.length) return res.status(404).json({ error: "Playlist not found" });
    const pos = await pool.query('SELECT COALESCE(MAX(position), -1) + 1 AS next FROM playlist_songs WHERE playlist_id=$1', [id]);
    await pool.query(
      'INSERT INTO playlist_songs (playlist_id, song_id, position) VALUES ($1,$2,$3) ON CONFLICT (playlist_id, song_id) DO NOTHING',
      [id, songId, pos.rows[0].next]
    );
    res.json({ ok: true });
  } catch { res.status(500).json({ error: "Failed to add song" }); }
};

exports.removePlaylistSong = async (req, res) => {
  try {
    const email = getEmail(req);
    if (!email) return res.status(401).json({ error: "Unauthorized" });
    const { id, songId } = req.params;
    const own = await pool.query('SELECT id FROM playlists WHERE id=$1 AND user_email=$2', [id, email]);
    if (!own.rows.length) return res.status(404).json({ error: "Playlist not found" });
    await pool.query('DELETE FROM playlist_songs WHERE playlist_id=$1 AND song_id=$2', [id, songId]);
    res.json({ ok: true });
  } catch { res.status(500).json({ error: "Failed to remove song" }); }
};

// ─── Sessions ─────────────────────────────────────────────────────────────────
exports.getSessions = async (req, res) => {
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '—';
  res.json([{ id:1, device:"This Browser", ip, lastActive:"Active now", isCurrent:true }]);
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
  } catch { res.status(500).json({ error:"Failed to fetch notifications" }); }
};

exports.markNotificationRead = async (req, res) => {
  try {
    const email = getEmail(req);
    const { id } = req.params;
    await pool.query('UPDATE notifications SET is_read=TRUE WHERE id=$1 AND user_email=$2', [id, email]);
    res.json({ message:"Marked as read" });
  } catch { res.status(500).json({ error:"Failed" }); }
};

exports.markAllNotificationsRead = async (req, res) => {
  try {
    const email = getEmail(req);
    await pool.query('UPDATE notifications SET is_read=TRUE WHERE user_email=$1', [email]);
    res.json({ message:"All marked as read" });
  } catch { res.status(500).json({ error:"Failed" }); }
};

// ─── Rate Song ────────────────────────────────────────────────────────────────
exports.rateSong = async (req, res) => {
  try {
    const email = getEmail(req);
    if (!email) return res.status(401).json({ error:"Unauthorized" });
    const { id:songId } = req.params;
    const { rating } = req.body;
    if (rating===null||rating===undefined) {
      await pool.query('DELETE FROM song_ratings WHERE user_email=$1 AND song_id=$2', [email,songId]).catch(()=>{});
    } else {
      await pool.query(`INSERT INTO song_ratings (user_email,song_id,rating) VALUES ($1,$2,$3) ON CONFLICT (user_email,song_id) DO UPDATE SET rating=$3`, [email,songId,rating]).catch(()=>{});
    }
    res.json({ message:"Rating saved" });
  } catch { res.status(500).json({ error:"Failed to rate song" }); }
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
    res.json({ message:"Account deleted successfully" });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error("Delete account error:", e);
    res.status(500).json({ error:"Failed to delete account" });
  } finally { client.release(); }
};
