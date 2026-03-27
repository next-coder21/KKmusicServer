const pool = require('./src/models/User');

async function check() {
  try {
    const { rows } = await pool.query(`
      SELECT pg_get_constraintdef(oid) as constraint_def
      FROM pg_constraint
      WHERE conname = 'notifications_type_check'
    `);
    console.log("Constraint:", rows[0] ? rows[0].constraint_def : "Not found");
    
    // Also check column names
    const cols = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'notifications'
    `);
    console.log("Columns:", cols.rows.map(r => `${r.column_name} (${r.data_type})`));
    
    process.exit(0);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
}

check();
