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
router.get("/ai-insights", adminController.getAiInsights);

// Songs
router.get("/songs",          adminController.getSongs);
router.post("/songs",         adminController.addSong);
router.patch("/songs/:id",    adminController.updateSong);
router.delete("/songs/:id",   adminController.deleteSong);

// Genres (read-only for dropdowns)
router.get("/genres",         adminController.getGenres);

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

// Feedback / Suggestions (from mobile app)
router.get("/feedback",       adminController.getFeedback);
router.patch("/feedback/:id", adminController.updateFeedback);

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

// Cover image upload → server local storage
const fs = require('fs');
const path = require('path');
const pool = require('../config/db');

function makeCoverUpload(prefix) {
  const multerInst = require('multer');
  return multerInst({
    storage: multerInst.diskStorage({
      destination: (_req, _file, cb) => {
        const dir = path.join(__dirname, '../../public/covers');
        fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
      },
      filename: (req, _file, cb) => cb(null, `${prefix}${req.params.id}.jpg`),
    }),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      cb(/^image\//i.test(file.mimetype) ? null : new Error('Only image files allowed'), /^image\//i.test(file.mimetype));
    },
  }).single('cover');
}

router.post('/songs/:id/cover', (req, res) => {
  makeCoverUpload('song_')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'No image provided' });
    try {
      const base = process.env.SERVER_URL || 'https://api.lijishwilson.in/muves';
      const url = `${base}/covers/song_${req.params.id}.jpg`;
      await pool.query('UPDATE songs SET cover_url = $1 WHERE id = $2', [url, req.params.id]);
      res.json({ url });
    } catch (e) {
      res.status(500).json({ error: 'Cover upload failed' });
    }
  });
});

router.post('/albums/:id/cover', (req, res) => {
  makeCoverUpload('album_')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'No image provided' });
    try {
      const base = process.env.SERVER_URL || 'https://api.lijishwilson.in/muves';
      const url = `${base}/covers/album_${req.params.id}.jpg`;
      await pool.query('UPDATE albums SET cover_url = $1 WHERE id = $2', [url, req.params.id]);
      res.json({ url });
    } catch (e) {
      res.status(500).json({ error: 'Cover upload failed' });
    }
  });
});

// Audio upload → Google Drive
const multer = require('multer');
const { uploadToDrive } = require('../utils/driveUpload');
const audioUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 100 * 1024 * 1024 }, // 100 MB
  fileFilter: (_req, file, cb) => {
    const ok = /^audio\//i.test(file.mimetype) || /\.(mp3|m4a|flac|wav|ogg|aac)$/i.test(file.originalname);
    cb(ok ? null : new Error('Only audio files are allowed'), ok);
  },
}).single('audio');

router.post('/upload-audio', (req, res) => {
  audioUpload(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'No audio file provided' });
    try {
      const result = await uploadToDrive(req.file.buffer, req.file.originalname, req.file.mimetype);
      res.json(result);
    } catch (e) {
      console.error('Drive upload error:', e.message);
      res.status(500).json({ error: e.message || 'Upload failed' });
    }
  });
});

// Lyrics — save (admin only)
const musicController = require("../controllers/musicController");
router.post("/songs/:id/lyrics", musicController.saveLyrics);

// Lyrics Generator (Groq + Whisper)
const lyricgenController = require("../controllers/lyricgenController");
router.post("/lyricgen", lyricgenController.generateLyrics);

module.exports = router;
