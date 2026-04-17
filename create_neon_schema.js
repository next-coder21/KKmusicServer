const { Pool } = require('pg');
const fs = require('fs');
require('dotenv').config();

const NEON_URL = "postgresql://KKmusic_owner:npg_Gq1XUYTFHy9E@ep-frosty-king-a13urub5-pooler.ap-southeast-1.aws.neon.tech/KKmusic?sslmode=require";
const neonPool = new Pool({ connectionString: NEON_URL, ssl: true });

async function createSchema() {
  console.log('👷 Initializing Neon Schema (Clean)...');
  const sql = fs.readFileSync('../migration_local.sql', 'utf8');
  
  // Clean the SQL: remove RAISE statements and DO blocks that we don't need for schema-only
  // We want the CREATE/ALTER/INDEX commands.
  let cleanSql = sql.replace(/DO \$\$[\s\S]*?END \$\$;/g, ''); // Remove DO blocks
  cleanSql = cleanSql.replace(/RAISE NOTICE[\s\S]*?;/g, ''); // Remove stray RAISE NOTICE if any
  
  try {
    const client = await neonPool.connect();
    try {
      await client.query('BEGIN');
      
      // Execute all commands
      await client.query(cleanSql);
      
      await client.query('COMMIT');
      console.log('✅ Base Schema initialized successfully on Neon.');
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('❌ Schema initialization failed:', err.message);
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Fatal Connection Error:', err);
  } finally {
    await neonPool.end();
  }
}

createSchema();
