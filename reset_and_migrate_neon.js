/**
 * CLEAN RESET MIGRATION SCRIPT: Local -> Neon (Production)
 * This script WIPES your Neon database tables and re-copies fresh data from local.
 */

const { Pool } = require('pg');
require('dotenv').config();

const LOCAL_URL = process.env.DATABASE_URL;
const NEON_URL = "postgresql://KKmusic_owner:npg_Gq1XUYTFHy9E@ep-frosty-king-a13urub5-pooler.ap-southeast-1.aws.neon.tech/KKmusic?sslmode=require";

const localPool = new Pool({ connectionString: LOCAL_URL });
const neonPool = new Pool({ connectionString: NEON_URL, ssl: true });

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

async function resetAndMigrate() {
  console.log('🚮 Cleaning Neon Database and Starting Fresh Migration...');
  
  try {
    const client = await neonPool.connect();
    try {
      await client.query('BEGIN');
      
      // 1. Wipe everything (in reverse dependency order if needed, but CASCADE helps)
      console.log('Wiping all tables...');
      for (const table of TABLES.slice().reverse()) {
        await client.query(`TRUNCATE TABLE ${table} RESTART IDENTITY CASCADE`);
      }
      
      await client.query('COMMIT');
      console.log('✅ Neon Database WIPED clean.');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    // 2. Rerun migration
    for (const table of TABLES) {
      console.log(`\n--- Migrating table: ${table} ---`);
      const { rows, fields } = await localPool.query(`SELECT * FROM ${table}`);
      if (rows.length === 0) {
        console.log(`Skipping ${table}: No data.`);
        continue;
      }
      console.log(`Found ${rows.length} rows in local ${table}.`);

      const columns = fields.map(f => f.name).join(', ');
      const placeholders = fields.map((_, i) => `$${i + 1}`).join(', ');
      
      const subClient = await neonPool.connect();
      try {
        await subClient.query('BEGIN');
        for (const row of rows) {
          const values = fields.map(f => row[f.name]);
          await subClient.query(`INSERT INTO ${table} (${columns}) VALUES (${placeholders})`, values);
        }
        await subClient.query('COMMIT');
        console.log(`✅ ${table}: Successfully migrated.`);
      } catch (err) {
        await subClient.query('ROLLBACK');
        console.error(`❌ ${table}: Migration failed:`, err.message);
      } finally {
        subClient.release();
      }
    }
    
    console.log('\n✨ FRESH MIGRATION COMPLETE! ✨');
  } catch (err) {
    console.error('Fatal Migration Error:', err);
  } finally {
    await localPool.end();
    await neonPool.end();
  }
}

resetAndMigrate();
