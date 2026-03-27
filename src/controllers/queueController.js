const pool = require("../config/db"); // Ensure correct DB connection

/**
 * Add song(s) to the relational queue
 * @param {string} email - User email
 * @param {string[]} songIds - Array of song IDs (UUIDs)
 * @param {boolean} album - If true, replaces the existing queue. Otherwise, appends.
 */
exports.addToQueue = async (req, res) => {
  try {
      const { email, songIds, album } = req.body;

      if (!email || !Array.isArray(songIds) || songIds.length === 0) {
          return res.status(400).json({ message: "Invalid request: email or songIds missing" });
      }

      const client = await pool.connect();
      try {
          await client.query('BEGIN');

          if (album) {
              // Replace entire queue
              await client.query("DELETE FROM queue WHERE user_email = $1", [email]);
          }

          // Get the current max position to append correctly
          const posRes = await client.query(
            "SELECT COALESCE(MAX(position), -1) as max_pos FROM queue WHERE user_email = $1",
            [email]
          );
          let currentPos = posRes.rows[0].max_pos + 1;

          // Bulk insert new songs with sequential positions
          for (const songId of songIds) {
              await client.query(
                  `INSERT INTO queue (user_email, song_id, position) 
                   VALUES ($1, $2, $3) 
                   ON CONFLICT (user_email, position) DO NOTHING`,
                  [email, songId, currentPos++]
              );
          }

          await client.query('COMMIT');
          return res.status(200).json({ message: "Songs added to queue successfully" });
      } catch (err) {
          await client.query('ROLLBACK');
          throw err;
      } finally {
          client.release();
      }
  } catch (error) {
      console.error("Error adding to queue:", error);
      return res.status(500).json({ message: "Internal server error" });
  }
};

/**
 * Get user's queue in correct order
 */
exports.getQueue = async (req, res) => {
    try {
      const { email } = req.params;
      const { rows } = await pool.query(
        "SELECT song_id FROM queue WHERE user_email = $1 ORDER BY position ASC",
        [email]
      );
      
      // Return flat array of song IDs to match frontend expectation
      res.json({ queue: rows.map(r => r.song_id) });
    } catch (error) {
      console.error("Error fetching queue:", error);
      res.status(500).json({ error: "Internal Server Error" });
    }
};

/**
 * Remove a specific song from the queue
 */
exports.removeFromQueue = async (req, res) => {
    try {
      const { email, songId } = req.body;
      
      await pool.query(
        "DELETE FROM queue WHERE user_email = $1 AND song_id = $2",
        [email, songId]
      );

      res.json({ message: "Song removed from queue" });
    } catch (error) {
      console.error("Error removing from queue:", error);
      res.status(500).json({ error: "Internal Server Error" });
    }
};

/**
 * Clear the entire queue for a user
 */
exports.clearQueue = async (req, res) => {
    try {
      const { email } = req.params;
      await pool.query("DELETE FROM queue WHERE user_email = $1", [email]);
      res.json({ message: "Queue cleared" });
    } catch (error) {
      console.error("Error clearing queue:", error);
      res.status(500).json({ error: "Internal Server Error" });
    }
};