const pool = require('./src/models/User');

async function check() {
  try {
    const { rows } = await pool.query("SELECT to_regclass('public.announcements') as exists");
    console.log("Announcement table check:", rows[0].exists);
    process.exit(0);
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
}

check();
