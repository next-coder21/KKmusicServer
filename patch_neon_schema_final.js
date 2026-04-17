const { Pool } = require('pg');
require('dotenv').config();

const NEON_URL = "postgresql://KKmusic_owner:npg_Gq1XUYTFHy9E@ep-frosty-king-a13urub5-pooler.ap-southeast-1.aws.neon.tech/KKmusic?sslmode=require";
const neonPool = new Pool({ connectionString: NEON_URL, ssl: true });

async function patchSchemaFinal() {
  console.log('🩹 Final Patching Neon Schema...');
  
  const patches = [
    // Ads: Add weight
    `ALTER TABLE ads ADD COLUMN IF NOT EXISTS weight INTEGER DEFAULT 1`,
    
    // Notifications: Update check constraint
    // First find the constraint name
    `ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check`,
    `ALTER TABLE notifications ADD CONSTRAINT notifications_type_check 
     CHECK (type IN ('new_release','playlist_shared','system','promo','follow','event','maintenance'))`
  ];

  const client = await neonPool.connect();
  try {
    await client.query('BEGIN');
    for (const sql of patches) {
      console.log(`Running: ${sql.substring(0, 50)}...`);
      await client.query(sql);
    }
    await client.query('COMMIT');
    console.log('✅ Neon Schema patched successfully (Final).');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Patch failed:', err.message);
  } finally {
    client.release();
    await neonPool.end();
  }
}

patchSchemaFinal();
