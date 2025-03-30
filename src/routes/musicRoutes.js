const express = require("express");
const router = express.Router();
const musicController = require("../controllers/musicController");

// API Routes
router.get("/songs", musicController.getAllSongs);
router.get("/songs/:id", musicController.getSongById);
router.get("/stream/:id", musicController.streamAudio);

module.exports = router;
