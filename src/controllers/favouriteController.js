const pool = require("../config/db");

exports.addFavourites = async (req, res) => {
    const { email, songIds } = req.body;
    console.log("Favourite Toggle Called");

    if (!email || !Array.isArray(songIds) || songIds.length === 0) {
        return res.status(400).json({ error: "Invalid request. Email and song IDs are required." });
    }

    try {
        const query = `
            INSERT INTO favourites (user_email, song_ids)
            VALUES ($1, $2::UUID[])
            ON CONFLICT (user_email) 
            DO UPDATE SET song_ids = (
                SELECT ARRAY(
                    SELECT DISTINCT UNNEST(
                        CASE 
                            -- If song exists, remove it
                            WHEN $2 <@ favourites.song_ids THEN array_remove(favourites.song_ids, $2[1])
                            -- Otherwise, add it
                            ELSE array_cat(favourites.song_ids, $2::UUID[]) 
                        END
                    )
                )
            )
            RETURNING *;
        `;

        const values = [email, songIds];

        const result = await pool.query(query, values);

        res.json({ status:"success", message: "Favourite updated", data: result.rows[0] });
    } catch (error) {
        console.error("Error updating favourites:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};
  
  // ✅ Get User's Favourites
  exports.getFavourites = async (req, res) => {
    console.log("Touched Get Queue For Favourites");
    
    const { email } = req.params;
  
    if (!email) {
      return res.status(400).json({ error: "Email is required." });
    }
  
    try {
      const query = `SELECT song_ids FROM favourites WHERE user_email = $1;`;
      const result = await pool.query(query, [email]);
  
      if (result.rows.length === 0) {
        return res.json({ favourites: [] });
      }
  
      res.json({ favourites: result.rows[0].song_ids });
    } catch (error) {
      console.error("Error fetching favourites:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  };
  
  // ✅ Remove Song(s) from Favourites
  exports.removeFavourites = async (req, res) => {
    console.log("Touched Remove Favourites");
    
    const { email, songIds } = req.body;

    console.log("From remove", email, songIds);
    
    if (!email || !Array.isArray(songIds) || songIds.length === 0) {
        return res.status(400).json({ error: "Invalid request. Email and song IDs are required." });
    }

    try {
        const query = `
            UPDATE favourites
            SET song_ids = array_remove(song_ids, s.id)
            FROM (SELECT unnest($2::UUID[]) AS id) AS s
            WHERE user_email = $1
            RETURNING *;
        `;

        const values = [email, songIds];

        const result = await pool.query(query, values);

        if (result.rowCount === 0) {
            return res.status(404).json({ error: "No favourites found for this user." });
        }

        res.json({ status:"success", message: "Removed from favourites", data: result.rows[0] });
    } catch (error) {
        console.error("Error removing from favourites:", error);
        res.status(500).json({ error: "Internal server error" });
    }
};