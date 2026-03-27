const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../models/User');
require('dotenv').config();

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

    // 3. Seed default admin if table is empty
    const { rows } = await pool.query('SELECT COUNT(*) FROM admin_users');
    if (parseInt(rows[0].count) === 0) {
      const hash = await bcrypt.hash('admin123', 10);
      await pool.query(
        "INSERT INTO admin_users (email, password, name, role) VALUES ($1, $2, $3, $4)",
        ['admin@kkmusic.com', hash, 'Super Admin', 'super_admin']
      );
      console.log('✅ Default admin created: admin@kkmusic.com / admin123');
    }

    console.log('✅ admin_users table ready.');
  } catch (err) {
    console.error("Admin DB Init Error:", err.message);
  }
};
initAdminTable();

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
      { expiresIn: '1d' }
    );

    res.cookie("admin_token", token, {
      httpOnly: true,
      secure:   process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? "None" : "Lax",
      maxAge:   24 * 60 * 60 * 1000,
    });

    res.json({ message: "Admin login successful", admin: { id: admin.id, name: admin.name, email: admin.email, role: admin.role } });
  } catch (error) {
    console.error("Admin login error:", error);
    res.status(500).json({ error: "Login failed" });
  }
};

exports.logout = (req, res) => {
  res.clearCookie("admin_token");
  res.json({ message: "Logged out" });
};

exports.checkAuth = (req, res) => {
  res.json({ isAdmin: true, admin: { adminId: req.admin.adminId, name: req.admin.name } });
};

// ─── Dashboard stats ──────────────────────────────────────────────────────────
exports.getDashboardStats = async (req, res) => {
  try {
    const [users, songs, artists, albums, reports, plays, topSongs] = await Promise.all([
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
    ]);

    res.json({
      totalUsers:     parseInt(users.rows[0].count),
      totalSongs:     parseInt(songs.rows[0].count),
      totalArtists:   parseInt(artists.rows[0].count),
      totalAlbums:    parseInt(albums.rows[0].count),
      pendingReports: parseInt(reports.rows[0].count),
      totalPlays:     parseInt(plays.rows[0].total),
      topSongs:       topSongs.rows,
    });
  } catch (error) {
    console.error("Dashboard stats error:", error);
    res.status(500).json({ error: "Failed to fetch stats" });
  }
};

// ─── Songs CRUD ───────────────────────────────────────────────────────────────
exports.getSongs = async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        s.id, s.title, s.cover_url, s.audiourl,
        s.duration_seconds, s.play_count, s.is_explicit, s.created_at,
        a.name     AS artist_name,
        a.id       AS artist_id,
        al.title   AS album_title,
        al.id      AS album_id
      FROM songs s
      LEFT JOIN artists a  ON s.artist_id = a.id
      LEFT JOIN albums  al ON s.album_id  = al.id
      ORDER BY s.created_at DESC
      LIMIT 200
    `);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
};

exports.addSong = async (req, res) => {
  try {
    const { title, artist_id, album_id, audiourl, cover_url, duration_seconds } = req.body;
    const { rows } = await pool.query(
      `INSERT INTO songs (title, artist_id, album_id, audiourl, cover_url, duration_seconds)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [title, artist_id || null, album_id || null, audiourl, cover_url || null, parseInt(duration_seconds) || 0]
    );
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
};

exports.deleteSong = async (req, res) => {
  try {
    await pool.query('DELETE FROM songs WHERE id = $1', [req.params.id]);
    res.json({ message: "Song deleted" });
  } catch (e) { res.status(500).json({ error: e.message }); }
};

// PATCH /admin/songs/:id — update any subset of fields (used for album/artist mapping)
exports.updateSong = async (req, res) => {
  try {
    const { id } = req.params;
    const allowed = ['title','cover_url','audiourl','duration_seconds','artist_id','album_id','is_explicit','lyrics'];
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
