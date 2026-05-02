const express = require("express");
const multer  = require("multer");
const authController  = require("../controllers/authController");
const userController  = require("../controllers/userController");
const musicController = require("../controllers/musicController");
const { authMiddleware } = require("../middleware/authMiddleware");

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

// ── Public auth ──────────────────────────────────────────────────────────────
router.post("/register",          authController.register);
router.post("/login",             authController.login);
router.post("/verify-security",   authController.verifySecurityAnswer);
router.post("/reset-password",    authController.resetPassword);
router.post("/logout",            authController.logout);
router.get ("/check-auth",        authMiddleware, authController.checkAuth);

// ── Public Ads ───────────────────────────────────────────────────────────────
const adController = require("../controllers/adController");
router.get("/ads/active",       adController.getActiveAd);

// ── Account ──────────────────────────────────────────────────────────────────
router.post  ("/update-account", authMiddleware, upload.single("image"), authController.updateAccount);
router.delete("/account",        authMiddleware, userController.deleteAccount);

// ── User data ────────────────────────────────────────────────────────────────
router.get   ("/stats",        authMiddleware, userController.getStats);
router.get   ("/play-history", authMiddleware, userController.getPlayHistory);
router.delete("/play-history", authMiddleware, userController.clearPlayHistory);
router.get   ("/top-genres",   authMiddleware, userController.getUserTopGenres);
router.get   ("/search",       authMiddleware, userController.search);
router.get   ("/sessions",     authMiddleware, userController.getSessions);

// ── Playlists (full CRUD) ─────────────────────────────────────────────────────
router.get   ("/playlists",                       authMiddleware, userController.getPlaylists);
router.post  ("/playlists",                       authMiddleware, userController.createPlaylist);
router.patch ("/playlists/:id",                   authMiddleware, userController.updatePlaylist);
router.delete("/playlists/:id",                   authMiddleware, userController.deletePlaylist);
// Playlist songs
router.get   ("/playlists/:id/songs",             authMiddleware, userController.getPlaylistSongs);
router.post  ("/playlists/:id/songs",             authMiddleware, userController.addPlaylistSong);
router.delete("/playlists/:id/songs/:songId",     authMiddleware, userController.removePlaylistSong);

// ── Notifications ─────────────────────────────────────────────────────────────
router.get   ("/notifications",          authMiddleware, userController.getNotifications);
// IMPORTANT: read-all MUST come before /:id/read — Express matches in declaration order
router.patch ("/notifications/read-all", authMiddleware, userController.markAllNotificationsRead);
router.patch ("/notifications/:id/read", authMiddleware, userController.markNotificationRead);

// ── Song interactions ─────────────────────────────────────────────────────────
router.post("/songs/:id/rate",        authMiddleware, userController.rateSong);
router.post("/music/record-play/:id", authMiddleware, musicController.recordPlay);

// ── Lyrics ───────────────────────────────────────────────────────────────────
router.get ("/music/songs/:id/lyrics", musicController.getLyrics);
router.post("/music/songs/:id/lyrics", authMiddleware, musicController.saveLyrics);

module.exports = router;
