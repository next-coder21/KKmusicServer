const pool = require('./src/models/User');

async function migrate() {
  try {
    console.log("Updating notifications_type_check constraint...");
    
    // First, drop the old constraint
    await pool.query("ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check");
    
    // Add the expanded constraint
    await pool.query(`
      ALTER TABLE notifications 
      ADD CONSTRAINT notifications_type_check 
      CHECK (type IN ('system', 'promo', 'new_release', 'event', 'maintenance', 'follow', 'playlist_shared'))
    `);
    
    console.log("✅ notifications_type_check updated successfully.");
    process.exit(0);
  } catch (e) {
    console.error("Migration failed:");
    console.error(e);
    process.exit(1);
  }
}

migrate();
