const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
// Since this is in src/scripts/migrate.js, the .env is in the parent directory of src
require('dotenv').config({ path: path.join(__dirname, '../../.env.development') });

console.log('--- DEBUG ---');
console.log('__dirname:', __dirname);
const envPath = path.join(__dirname, '../../.env.development');
console.log('Looking for .env at:', envPath);
console.log('File exists:', fs.existsSync(envPath));
console.log('DATABASE_URL present:', !!process.env.DATABASE_URL);
if (process.env.DATABASE_URL) {
    console.log('DATABASE_URL prefix:', process.env.DATABASE_URL.substring(0, 20));
}
console.log('-------------');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function runMigration() {
  const sqlFile = path.join(__dirname, '../../../migration_local.sql');
  console.log('Reading migration file from:', sqlFile);
  const sql = fs.readFileSync(sqlFile, 'utf8');

  // We want to run Section 0 to Section 4
  const sectionsToRun = sql.split('-- SECTION 5')[0];

  console.log('Starting Migration (Sections 0-4)...');
  
  try {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sectionsToRun);
      await client.query('COMMIT');
      console.log('✅ Migration Sections 0-4 completed successfully.');
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('❌ Migration failed:', err);
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Could not connect to database:', err);
  } finally {
    await pool.end();
  }
}

runMigration();
