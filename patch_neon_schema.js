const { Pool } = require('pg');
require('dotenv').config();

const NEON_URL = "postgresql://KKmusic_owner:npg_Gq1XUYTFHy9E@ep-frosty-king-a13urub5-pooler.ap-southeast-1.aws.neon.tech/KKmusic?sslmode=require";
const neonPool = new Pool({ connectionString: NEON_URL, ssl: true });

async function patchSchema() {
  console.log('🩹 Patching Neon Schema...');
  
  const patches = [
    `CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`,
    
    // Users
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE`,
    
    // Songs
    `ALTER TABLE songs ADD COLUMN IF NOT EXISTS lyrics TEXT`,
    
    // Ads
    `ALTER TABLE ads ADD COLUMN IF NOT EXISTS advertiser VARCHAR(255)`,
    `ALTER TABLE ads ADD COLUMN IF NOT EXISTS image_url TEXT`,
    `ALTER TABLE ads ADD COLUMN IF NOT EXISTS link_url TEXT`,
    
    // Announcements (Full Table)
    `CREATE TABLE IF NOT EXISTS announcements (
      id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      title         VARCHAR(255) NOT NULL,
      body          TEXT NOT NULL,
      type          VARCHAR(50),
      target        VARCHAR(50),
      target_emails JSONB,
      action_url    TEXT,
      action_label  VARCHAR(100),
      image_url     TEXT,
      is_published  BOOLEAN DEFAULT FALSE,
      scheduled_at  TIMESTAMP,
      sent_at       TIMESTAMP,
      created_by    INTEGER REFERENCES admin_users(id),
      created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`
  ];

  const client = await neonPool.connect();
  try {
    await client.query('BEGIN');
    for (const sql of patches) {
      console.log(`Running: ${sql.substring(0, 50)}...`);
      await client.query(sql);
    }
    await client.query('COMMIT');
    console.log('✅ Neon Schema patched successfully.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Patch failed:', err.message);
  } finally {
    client.release();
    await neonPool.end();
  }
}

patchSchema();
