const express = require("express");
const adminController = require("../controllers/adminController");
const { adminAuthMiddleware } = require("../middleware/adminAuthMiddleware");

const router = express.Router();

// Public routes for admins
router.post("/login", adminController.login);
router.post("/logout", adminController.logout);

// Protected routes (Admin Only)
router.use(adminAuthMiddleware);

router.get("/check-auth", adminController.checkAuth);
router.get("/stats", adminController.getDashboardStats);

// Songs
router.get("/songs",          adminController.getSongs);
router.post("/songs",         adminController.addSong);
router.patch("/songs/:id",    adminController.updateSong);   // ← album/artist mapping
router.delete("/songs/:id",   adminController.deleteSong);

// Artists
router.get("/artists", adminController.getArtists);
router.post("/artists", adminController.addArtist);
router.patch("/artists/:id", adminController.updateArtist);
router.delete("/artists/:id", adminController.deleteArtist);

// Albums
router.get("/albums", adminController.getAlbums);
router.post("/albums", adminController.addAlbum);
router.patch("/albums/:id", adminController.updateAlbum);
router.delete("/albums/:id", adminController.deleteAlbum);

// Users
router.get("/users", adminController.getUsers);
router.delete("/users/:id", adminController.deleteUser);

// Reports
router.get("/reports", adminController.getReports);
router.patch("/reports/:id", adminController.updateReport);

// Announcements
const announcementController = require("../controllers/announcementController");
router.get("/announcements", announcementController.getAnnouncements);
router.get("/announcements/:id", announcementController.getAnnouncementById);
router.post("/announcements", announcementController.upload, announcementController.createAnnouncement);
router.put("/announcements/:id", announcementController.upload, announcementController.updateAnnouncement);
router.delete("/announcements/:id", announcementController.deleteAnnouncement);
router.post("/announcements/:id/publish", announcementController.publishAnnouncement);
router.get("/announcements/:id/preview", announcementController.previewAnnouncement);
router.get("/announcements/:id/stats", announcementController.getAnnouncementStats);

// Ads
const adController = require("../controllers/adController");
router.get("/ads", adController.getAds);
router.post("/ads", adController.addAd);
router.patch("/ads/:id", adController.updateAd);
router.delete("/ads/:id", adController.deleteAd);

// Lyrics Generator (Groq + Whisper)
const lyricgenController = require("../controllers/lyricgenController");
router.post("/lyricgen", lyricgenController.generateLyrics);

module.exports = router;
