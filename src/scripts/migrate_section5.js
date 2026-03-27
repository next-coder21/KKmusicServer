const { Pool } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env.development') });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function runSection5() {
  console.log('Starting Migration (Section 5)...');
  
  try {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('ALTER TABLE queue_new RENAME TO queue_relational');
      await client.query('ALTER TABLE favourites_new RENAME TO favourites_relational');
      await client.query('COMMIT');
      console.log('✅ Migration Section 5 completed successfully.');
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

runSection5();
