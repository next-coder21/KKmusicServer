const { Pool } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env.development') });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function checkDetails() {
  try {
    const table = 'users';
    console.log(`--- Checking table: ${table} ---`);
    const cols = await pool.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = $1`, [table]);
    console.log(cols.rows);
  } catch (err) {
    console.error('Error checking details:', err);
  } finally {
    await pool.end();
  }
}

checkDetails();
