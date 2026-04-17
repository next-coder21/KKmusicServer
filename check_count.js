const { Pool } = require('pg');
require('dotenv').config();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
async function checkCount() {
  const res = await pool.query('SELECT COUNT(*) FROM songs');
  console.log('Songs count:', res.rows[0].count);
  await pool.end();
}
checkCount();
