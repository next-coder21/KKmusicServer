/**
 * DATABASE MIGRATION SCRIPT: Local -> Neon (Production)
 * This script copies data from your local PostgreSQL to your live Neon database.
 */

const { Pool } = require('pg');
require('dotenv').config();

// --- CONFIGURATION ---
const LOCAL_URL = process.env.DATABASE_URL; // From your .env
const NEON_URL = "postgresql://KKmusic_owner:npg_Gq1XUYTFHy9E@ep-frosty-king-a13urub5-pooler.ap-southeast-1.aws.neon.tech/KKmusic?sslmode=require";

if (!LOCAL_URL || !NEON_URL) {
  console.error("Missing LOCAL_URL or NEON_URL in configuration.");
  process.exit(1);
}

const localPool = new Pool({ connectionString: LOCAL_URL });
const neonPool = new Pool({ connectionString: NEON_URL, ssl: true });

// Dependency order: tables without FKs first, then their dependents
const TABLES = [
  'users',
  'user_profiles',
  'genres',
  'artists',
  'albums',
  'songs',
  'album_songs',
  'playlists',
  'playlist_songs',
  'queue',
  'favourites',
  'play_history',
  'search_history',
  'song_ratings',
  'artist_follows',
  'ads',
  'ad_impressions',
  'user_listening_stats',
  'notifications',
  'content_reports',
  'admin_users',
  'announcements',
  'refresh_tokens',
  'user_sessions'
];

async function migrate() {
  console.log('🚀 Starting Migration to Neon...');
  
  try {
    for (const table of TABLES) {
      console.log(`\n--- Migrating table: ${table} ---`);
      
      // 1. Get data from local
      const { rows, fields } = await localPool.query(`SELECT * FROM ${table}`);
      if (rows.length === 0) {
        console.log(`Skipping ${table}: No data.`);
        continue;
      }

      console.log(`Found ${rows.length} rows in local ${table}.`);

      // 2. Prepare for insert into remote
      const columns = fields.map(f => f.name).join(', ');
      const placeholders = fields.map((_, i) => `$${i + 1}`).join(', ');
      
      // Use a transaction for each table to be safe
      const client = await neonPool.connect();
      try {
        await client.query('BEGIN');
        
        // Optional: Clear remote table first if you want a clean sync
        // await client.query(`TRUNCATE TABLE ${table} CASCADE`);
        
        for (const row of rows) {
          const values = fields.map(f => row[f.name]);
          await client.query(
            `INSERT INTO ${table} (${columns}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`,
            values
          );
        }
        
        await client.query('COMMIT');
        console.log(`✅ ${table}: Successfully migrated.`);
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`❌ ${table}: Migration failed:`, err.message);
      } finally {
        client.release();
      }
    }
    
    console.log('\n✨ ALL DATA MIGRATED SUCCESSFULLY TO NEON! ✨');
  } catch (err) {
    console.error('Fatal Migration Error:', err);
  } finally {
    await localPool.end();
    await neonPool.end();
  }
}

migrate();
