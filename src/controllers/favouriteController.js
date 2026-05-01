const pool = require("../config/db");

exports.addFavourites = async (req, res) => {
  const email = req.user?.email;
  const { songIds } = req.body;

  if (!email) return res.status(401).json({ error: "Unauthorized" });
  if (!Array.isArray(songIds) || songIds.length === 0)
    return res.status(400).json({ error: "songIds must be a non-empty array" });
  if (songIds.length > 100)
    return res.status(400).json({ error: "Cannot modify more than 100 songs at once" });

  try {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      for (const songId of songIds) {
        const checkRes = await client.query(
          "SELECT id FROM favourites WHERE user_email = $1 AND song_id = $2",
          [email, songId]
        );
        if (checkRes.rows.length > 0) {
          await client.query(
            "DELETE FROM favourites WHERE user_email = $1 AND song_id = $2",
            [email, songId]
          );
        } else {
          await client.query(
            "INSERT INTO favourites (user_email, song_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
            [email, songId]
          );
        }
      }

      await client.query("COMMIT");
      res.json({ status: "success", message: "Favourites updated" });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("Error updating favourites:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

exports.getFavourites = async (req, res) => {
  const email = req.user?.email;
  if (!email) return res.status(401).json({ error: "Unauthorized" });

  try {
    const { rows } = await pool.query(
      "SELECT song_id FROM favourites WHERE user_email = $1 ORDER BY added_at DESC",
      [email]
    );
    res.json({ favourites: rows.map((r) => r.song_id) });
  } catch (error) {
    console.error("Error fetching favourites:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

exports.removeFavourites = async (req, res) => {
  const email = req.user?.email;
  const { songIds } = req.body;

  if (!email) return res.status(401).json({ error: "Unauthorized" });
  if (!Array.isArray(songIds) || songIds.length === 0)
    return res.status(400).json({ error: "songIds must be a non-empty array" });

  try {
    await pool.query(
      "DELETE FROM favourites WHERE user_email = $1 AND song_id = ANY($2::UUID[])",
      [email, songIds]
    );
    res.json({ status: "success", message: "Removed from favourites" });
  } catch (error) {
    console.error("Error removing from favourites:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};
