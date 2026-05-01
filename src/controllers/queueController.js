const pool = require("../config/db");

exports.addToQueue = async (req, res) => {
  try {
    const email = req.user?.email;
    if (!email) return res.status(401).json({ error: "Unauthorized" });

    const { songIds, album } = req.body;
    if (!Array.isArray(songIds) || songIds.length === 0)
      return res.status(400).json({ message: "songIds must be a non-empty array" });
    if (songIds.length > 500)
      return res.status(400).json({ message: "Cannot add more than 500 songs at once" });

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      if (album) {
        await client.query("DELETE FROM queue WHERE user_email = $1", [email]);
      }

      const posRes = await client.query(
        "SELECT COALESCE(MAX(position), -1) as max_pos FROM queue WHERE user_email = $1",
        [email]
      );
      let currentPos = posRes.rows[0].max_pos + 1;

      for (const songId of songIds) {
        await client.query(
          `INSERT INTO queue (user_email, song_id, position)
           VALUES ($1, $2, $3)
           ON CONFLICT (user_email, position) DO NOTHING`,
          [email, songId, currentPos++]
        );
      }

      await client.query("COMMIT");
      return res.status(200).json({ message: "Songs added to queue successfully" });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("Error adding to queue:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};

exports.getQueue = async (req, res) => {
  try {
    const email = req.user?.email;
    if (!email) return res.status(401).json({ error: "Unauthorized" });

    const { rows } = await pool.query(
      "SELECT song_id FROM queue WHERE user_email = $1 ORDER BY position ASC",
      [email]
    );
    res.json({ queue: rows.map((r) => r.song_id) });
  } catch (error) {
    console.error("Error fetching queue:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

exports.removeFromQueue = async (req, res) => {
  try {
    const email = req.user?.email;
    if (!email) return res.status(401).json({ error: "Unauthorized" });

    const { songId } = req.body;
    if (!songId) return res.status(400).json({ error: "songId is required" });

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

exports.clearQueue = async (req, res) => {
  try {
    const email = req.user?.email;
    if (!email) return res.status(401).json({ error: "Unauthorized" });

    await pool.query("DELETE FROM queue WHERE user_email = $1", [email]);
    res.json({ message: "Queue cleared" });
  } catch (error) {
    console.error("Error clearing queue:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};
