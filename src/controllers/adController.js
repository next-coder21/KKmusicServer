const pool = require('../models/User');

// ─── Ensure ads table is compatible ──────────────────────────────────────────
(async () => {
  try {
    // The table 'ads' likely already exists from migration.sql
    // We need to make sure our popup fields exist and audio fields are optional
    await pool.query(`
      ALTER TABLE ads 
      ALTER COLUMN audio_url DROP NOT NULL,
      ALTER COLUMN duration_seconds DROP NOT NULL
    `);
    
    // Add columns if they are missing (though migration.sql has most)
    await pool.query(`ALTER TABLE ads ADD COLUMN IF NOT EXISTS banner_image_url TEXT`);
    await pool.query(`ALTER TABLE ads ADD COLUMN IF NOT EXISTS target_url TEXT`);
    await pool.query(`ALTER TABLE ads ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE`);
    
    console.log('✅ ads table compatible.');
  } catch (err) {
    // If table doesn't exist at all (unlikely given the error), create it
    if (err.code === '42P01') { 
       try {
         await pool.query(`
           CREATE TABLE IF NOT EXISTS ads (
             id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
             title            VARCHAR(255) NOT NULL,
             banner_image_url TEXT,
             target_url       TEXT,
             audio_url        TEXT,
             duration_seconds INTEGER,
             is_active        BOOLEAN DEFAULT TRUE,
             created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
             updated_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP
           )
         `);
         console.log('✅ ads table created from scratch.');
       } catch (innerErr) {
         console.error('❌ ads table creation error:', innerErr.message);
       }
    } else {
      console.log('ℹ️ ads table check: ' + err.message);
    }
  }
})();

// ─── GET all ads (Admin) ──────────────────────────────────────────────────────
exports.getAds = async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM ads ORDER BY created_at DESC');
    res.json(rows);
  } catch (err) {
    console.error('getAds:', err);
    res.status(500).json({ error: 'Failed to fetch ads' });
  }
};

// ─── POST create new ad (Admin) ───────────────────────────────────────────────
exports.addAd = async (req, res) => {
  const { title, image_url, link_url, is_active } = req.body;
  if (!title) return res.status(400).json({ error: 'Title is required' });

  try {
    if (is_active) {
      await pool.query('UPDATE ads SET is_active = false');
    }
    const { rows } = await pool.query(
      `INSERT INTO ads (title, banner_image_url, target_url, is_active)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [title, image_url || null, link_url || null, is_active !== undefined ? is_active : true]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('addAd:', err);
    res.status(500).json({ error: 'Failed to create ad' });
  }
};

// ─── PATCH update ad (Admin) ──────────────────────────────────────────────────
exports.updateAd = async (req, res) => {
  const { id } = req.params;
  const { title, image_url, link_url, is_active } = req.body;

  try {
    if (is_active) {
      await pool.query('UPDATE ads SET is_active = false WHERE id != $1', [id]);
    }
    const { rows } = await pool.query(
      `UPDATE ads SET
        title            = COALESCE($1, title),
        banner_image_url = COALESCE($2, banner_image_url),
        target_url       = COALESCE($3, target_url),
        is_active        = COALESCE($4, is_active),
        updated_at       = CURRENT_TIMESTAMP
       WHERE id = $5 RETURNING *`,
      [title, image_url, link_url, is_active, id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Ad not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error('updateAd:', err);
    res.status(500).json({ error: 'Failed to update ad' });
  }
};

// ─── DELETE ad (Admin) ────────────────────────────────────────────────────────
exports.deleteAd = async (req, res) => {
  const { id } = req.params;
  try {
    const { rowCount } = await pool.query('DELETE FROM ads WHERE id = $1', [id]);
    if (!rowCount) return res.status(404).json({ error: 'Ad not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('deleteAd:', err);
    res.status(500).json({ error: 'Failed to delete ad' });
  }
};

// ─── GET active ad (Public — shown to users) ──────────────────────────────────
exports.getActiveAd = async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM ads WHERE is_active = true LIMIT 1');
    res.json(rows[0] || null);
  } catch (err) {
    console.error('getActiveAd:', err);
    res.status(500).json({ error: 'Failed to fetch active ad' });
  }
};
