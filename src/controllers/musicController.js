const pool = require("../config/db"); // PostgreSQL connection
const axios = require("axios");
const stream = require("stream");

/**
 * Get all songs from the database
 */
exports.getAllSongs = async (req, res) => {
    console.log("touched songs api");
    
  try {
    const { rows } = await pool.query(`SELECT * FROM Music
      ORDER BY 
        NULLIF(regexp_replace(title, '[^0-9]', '', 'g'), '')::INTEGER NULLS LAST, 
        NULLIF(regexp_replace(album, '[^0-9]', '', 'g'), '')::INTEGER NULLS LAST, 
        title;`);
    res.json(rows);
  } catch (error) {
    console.error("Error fetching songs:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

/**
 * Get a specific song by ID
 */
exports.getSongById = async (req, res) => {
  try {
    const { id } = req.params;
    const { rows } = await pool.query("SELECT * FROM Music WHERE id = $1", [id]);

    if (rows.length === 0) {
      return res.status(404).json({ error: "Song not found" });
    }

    res.json(rows[0]);
  } catch (error) {
    console.error("Error fetching song:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

/**
 * Stream audio from Google Drive
 */
exports.streamAudio = async (req, res) => {
  try {
    const { id } = req.params;

    // Fetch the audio URL from the database
    const { rows } = await pool.query("SELECT audiourl FROM Music WHERE id = $1", [id]);

    if (!rows.length || !rows[0].audiourl) {
      return res.status(404).json({ error: "Audio not found or missing URL" });
    }

    let audioUrl = rows[0].audiourl;
    console.log("Original Audio URL:", audioUrl);

    // 🎯 Extract Google Drive File ID
    const driveFileIdMatch = audioUrl.match(/\/d\/([^/]+)/);
    
    if (driveFileIdMatch) {
      const driveFileId = driveFileIdMatch[1]; // Extracted File ID
      console.log("Google Drive File ID:", driveFileId);

      // 🔥 Convert it to a direct download link
      audioUrl = `https://drive.google.com/uc?export=download&id=${driveFileId}`;
    }

    // Fetch the audio file as a stream
    const response = await axios({
      method: "GET",
      url: audioUrl,
      responseType: "stream",
    });

    // Set headers for audio streaming
    res.set({
      "Content-Type": "audio/mpeg",
      "Transfer-Encoding": "chunked",
    });

    // Stream audio to the client
    response.data.pipe(res);
  } catch (error) {
    console.error("Error streaming audio:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};

