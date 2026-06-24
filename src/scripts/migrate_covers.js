// One-time migration: download all external cover images (ucarecdn, etc.)
// and save them to public/covers/, then update cover_url in DB.
//
// Usage: node src/scripts/migrate_covers.js
require("dotenv").config();
const { Pool } = require("pg");
const axios   = require("axios");
const fs      = require("fs");
const path    = require("path");

const pool     = new Pool({ connectionString: process.env.DATABASE_URL });
const DIR      = path.join(__dirname, "../../public/covers");
const BASE_URL = process.env.SERVER_URL || "https://api.lijishwilson.in/muves";

async function download(url, dest) {
  const resp = await axios.get(url, {
    responseType: "arraybuffer",
    timeout: 30_000,
    headers: { "User-Agent": "Mozilla/5.0" },
    maxRedirects: 5,
  });
  fs.writeFileSync(dest, resp.data);
}

async function run() {
  fs.mkdirSync(DIR, { recursive: true });

  // ── Songs ─────────────────────────────────────────────────────
  const { rows: songs } = await pool.query(
    `SELECT id, cover_url FROM songs
     WHERE cover_url IS NOT NULL
       AND cover_url NOT LIKE '%api.lijishwilson.in%'`
  );
  console.log(`Songs to migrate: ${songs.length}`);

  for (const s of songs) {
    const dest   = path.join(DIR, `song_${s.id}.jpg`);
    const newUrl = `${BASE_URL}/covers/song_${s.id}.jpg`;
    try {
      await download(s.cover_url, dest);
      await pool.query("UPDATE songs SET cover_url = $1 WHERE id = $2", [newUrl, s.id]);
      console.log(`  ✓ song ${s.id}`);
    } catch (e) {
      console.error(`  ✗ song ${s.id}: ${e.message}`);
    }
  }

  // ── Albums ────────────────────────────────────────────────────
  const { rows: albums } = await pool.query(
    `SELECT id, cover_url FROM albums
     WHERE cover_url IS NOT NULL
       AND cover_url NOT LIKE '%api.lijishwilson.in%'`
  );
  console.log(`Albums to migrate: ${albums.length}`);

  for (const a of albums) {
    const dest   = path.join(DIR, `album_${a.id}.jpg`);
    const newUrl = `${BASE_URL}/covers/album_${a.id}.jpg`;
    try {
      await download(a.cover_url, dest);
      await pool.query("UPDATE albums SET cover_url = $1 WHERE id = $2", [newUrl, a.id]);
      console.log(`  ✓ album ${a.id}`);
    } catch (e) {
      console.error(`  ✗ album ${a.id}: ${e.message}`);
    }
  }

  await pool.end();
  console.log("\nMigration complete.");
}

run().catch((e) => { console.error(e); process.exit(1); });
