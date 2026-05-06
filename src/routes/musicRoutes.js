const express = require("express");
const router  = express.Router();
const musicController = require("../controllers/musicController");
const { authMiddleware } = require("../middleware/authMiddleware");

router.get("/songs",              musicController.getAllSongs);
router.get("/albums",             musicController.getAllAlbums);
router.get("/artists",            musicController.getAllArtists);
router.get("/genres",             musicController.getAllGenres);
router.get("/songs/:id",          musicController.getSongById);
router.get("/albums/:id/songs",   musicController.getSongsByAlbum);
router.get("/stream/:id",         musicController.streamAudio);
router.get("/cover/:id",          musicController.getCoverImage);
router.post("/record-play/:id",   authMiddleware, musicController.recordPlay);

module.exports = router;
