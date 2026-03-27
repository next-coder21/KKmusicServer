const pool = require('./src/models/User');

async function migrate() {
  try {
    console.log("Adding columns to admin_users...");
    
    // Check if name column exists
    const nameColRes = await pool.query(`
      SELECT column_name FROM information_schema.columns 
      WHERE table_name = 'admin_users' AND column_name = 'name'
    `);
    
    if (nameColRes.rows.length === 0) {
      await pool.query("ALTER TABLE admin_users ADD COLUMN name VARCHAR(100) DEFAULT 'Admin'");
      console.log("✅ Added 'name' column.");
    }

    // Check if role column exists
    const roleColRes = await pool.query(`
      SELECT column_name FROM information_schema.columns 
      WHERE table_name = 'admin_users' AND column_name = 'role'
    `);

    if (roleColRes.rows.length === 0) {
      await pool.query("ALTER TABLE admin_users ADD COLUMN role VARCHAR(20) DEFAULT 'content_manager'");
      console.log("✅ Added 'role' column.");
    }

    process.exit(0);
  } catch (e) {
    console.error("Migration failed:");
    console.error(e);
    process.exit(1);
  }
}

migrate();
