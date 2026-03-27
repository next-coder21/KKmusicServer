const { Pool } = require('pg');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../.env.development') });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function runSection6() {
  console.log('Starting Migration (Section 6)...');
  
  try {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Rename relational tables to intermediate final names
      await client.query('ALTER TABLE queue_relational RENAME TO queue_final');
      await client.query('ALTER TABLE favourites_relational RENAME TO favourites_final');

      // 2. Drop old tables
      await client.query('DROP TABLE IF EXISTS music CASCADE');
      await client.query('DROP TABLE IF EXISTS queue CASCADE');
      await client.query('DROP TABLE IF EXISTS favourites CASCADE');

      // 3. Rename intermediate to final production names
      await client.query('ALTER TABLE queue_final RENAME TO queue');
      await client.query('ALTER TABLE favourites_final RENAME TO favourites');

      // 4. Re-create indexes and triggers (from migration.sql Section 6)
      
      await client.query('DROP INDEX IF EXISTS idx_queue_new_user_email');
      await client.query('DROP INDEX IF EXISTS idx_favourites_new_user_email');
      await client.query('DROP INDEX IF EXISTS idx_favourites_new_song_id');

      await client.query('CREATE INDEX IF NOT EXISTS idx_queue_user_email ON queue(user_email, position)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_favourites_user_email ON favourites(user_email)');
      await client.query('CREATE INDEX IF NOT EXISTS idx_favourites_song_id ON favourites(song_id)');

      // Queue limit trigger
      await client.query(`
        CREATE OR REPLACE FUNCTION enforce_queue_limit()
        RETURNS TRIGGER AS $$
        BEGIN
          IF (SELECT COUNT(*) FROM queue WHERE user_email = NEW.user_email) >= 25 THEN
            DELETE FROM queue WHERE id = (
              SELECT id FROM queue WHERE user_email = NEW.user_email ORDER BY position ASC LIMIT 1
            );
            UPDATE queue SET position = position - 1 WHERE user_email = NEW.user_email;
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
      `);

      await client.query('DROP TRIGGER IF EXISTS trg_queue_limit ON queue');
      await client.query('CREATE TRIGGER trg_queue_limit BEFORE INSERT ON queue FOR EACH ROW EXECUTE FUNCTION enforce_queue_limit()');

      await client.query('COMMIT');
      console.log('✅ Migration Section 6 completed successfully. All tables are now relational.');
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

runSection6();
