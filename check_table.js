const { Pool } = require('pg');
require('dotenv').config();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
async function checkTable(table) {
  const res = await pool.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = $1`, [table]);
  console.log(`--- Columns for ${table} ---`);
  console.log(res.rows.map(r => `${r.column_name} (${r.data_type})`).join(', '));
  await pool.end();
}
checkTable(process.argv[2] || 'songs');
