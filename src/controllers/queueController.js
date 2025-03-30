const pool = require("../config/db"); // Ensure correct DB connection

exports.addToQueue = async (req, res) => {
  try {
      const { email, songIds, album } = req.body;

      if (!email || !Array.isArray(songIds) || songIds.length === 0) {
          return res.status(400).json({ message: "Invalid request: email or songIds missing" });
      }

      console.log("Received email:", email);
      console.log("Received song IDs:", songIds);
      console.log("Album:", album ? "Yes (Clearing Queue)" : "No (Appending)");

      // Limit the queue to 25 songs
      const insertQuery = `
          INSERT INTO queue (user_email, song_ids) 
VALUES ($1, $2::UUID[])
ON CONFLICT (user_email) 
DO UPDATE SET song_ids = 
    CASE 
        WHEN $3::boolean THEN $2::UUID[]  -- If album=true, replace queue
        ELSE (array_cat($2::UUID[], queue.song_ids))[:25] -- Prepend but limit to 25
    END;
      `;

      await pool.query(insertQuery, [email, songIds, album]);

      return res.status(200).json({ message: "Songs added to queue successfully" });
  } catch (error) {
      console.error("Error adding to queue:", error);
      return res.status(500).json({ message: "Internal server error" });
  }
};

exports.getQueue = async (req, res) => {
    console.log("TOched Get Queue");
    
    try {
      const { email } = req.params;
  
      const { rows } = await pool.query(
        "SELECT song_ids FROM queue WHERE user_email = $1",
        [email]
      );
  
      if (!rows.length) {
        return res.json({ queue: [] }); // Return empty if no queue exists
      }
  
      res.json({ queue: rows[0].song_ids });
    } catch (error) {
      console.error("Error fetching queue:", error);
      res.status(500).json({ error: "Internal Server Error" });
    }
  };
  

  exports.removeFromQueue = async (req, res) => {
    try {
      const { email, songId } = req.body;
  
      await pool.query(
        "UPDATE queue SET song_ids = array_remove(song_ids, $2) WHERE user_email = $1",
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
      const { email } = req.params;
  
      await pool.query("DELETE FROM queue WHERE user_email = $1", [email]);
  
      res.json({ message: "Queue cleared" });
    } catch (error) {
      console.error("Error clearing queue:", error);
      res.status(500).json({ error: "Internal Server Error" });
    }
  };
    