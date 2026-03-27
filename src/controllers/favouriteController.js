const pool = require("../config/db");

/**
 * Toggle or Add a song to favourites
 */
exports.addFavourites = async (req, res) => {
    const { email, songIds } = req.body;

    if (!email || !Array.isArray(songIds) || songIds.length === 0) {
        return res.status(400).json({ error: "Invalid request. Email and song IDs are required." });
    }

    try {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            for (const songId of songIds) {
                // Check if already in favourites
                const checkRes = await client.query(
                    "SELECT id FROM favourites WHERE user_email = $1 AND song_id = $2",
                    [email, songId]
                );

                if (checkRes.rows.length > 0) {
                    // Remove if it exists (Toggle)
                    await client.query(
                        "DELETE FROM favourites WHERE user_email = $1 AND song_id = $2",
                        [email, songId]
                    );
                } else {
                    // Otherwise Insert
                    await client.query(
                        "INSERT INTO favourites (user_email, song_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
                        [email, songId]
                    );
                }
            }

            await client.query('COMMIT');
            res.json({ status: "success", message: "Favourites updated" });
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    } catch (error) {
        console.error("Error updating favourites:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};

/**
 * Get user's favourites in relational format
 */
exports.getFavourites = async (req, res) => {
    const { email } = req.params;

    if (!email) {
      return res.status(400).json({ error: "Email is required." });
    }

    try {
      const { rows } = await pool.query(
        "SELECT song_id FROM favourites WHERE user_email = $1 ORDER BY added_at DESC", 
        [email]
      );
      
      // Return flat array of song IDs to match frontend expectation
      res.json({ favourites: rows.map(r => r.song_id) });
    } catch (error) {
      console.error("Error fetching favourites:", error);
      res.status(500).json({ error: "Internal server error" });
    }
};

/**
 * Bulk Remove from favourites
 */
exports.removeFavourites = async (req, res) => {
    const { email, songIds } = req.body;

    if (!email || !Array.isArray(songIds) || songIds.length === 0) {
        return res.status(400).json({ error: "Invalid request. Email and song IDs are required." });
    }

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