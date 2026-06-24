const express = require("express");
const multer  = require("multer");
const authController  = require("../controllers/authController");
const userController  = require("../controllers/userController");
const musicController = require("../controllers/musicController");
const { authMiddleware } = require("../middleware/authMiddleware");

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

// ── Public auth ──────────────────────────────────────────────────────────────
router.post("/register",         authController.register);
router.post("/login",            authController.login);
router.post("/refresh",          authController.refresh);
router.post("/forgot-password",  authController.forgotPassword);
router.post("/verify-otp",       authController.verifyOtp);
router.post("/reset-password",   authController.resetPassword);
router.post("/logout",           authController.logout);
router.get ("/check-auth",       authMiddleware, authController.checkAuth);

// ── Ads ───────────────────────────────────────────────────────────────────────
const adController = require("../controllers/adController");
router.get ("/ads/active",            authMiddleware, adController.getActiveAd);
router.post("/ads/:id/interaction",   authMiddleware, adController.recordAdInteraction);

// ── Account ──────────────────────────────────────────────────────────────────
router.post  ("/update-account", authMiddleware, upload.single("image"), authController.updateAccount);
router.delete("/account",        authMiddleware, userController.deleteAccount);

// ── User data ────────────────────────────────────────────────────────────────
router.get   ("/stats",        authMiddleware, userController.getStats);
router.get   ("/play-history", authMiddleware, userController.getPlayHistory);
router.delete("/play-history", authMiddleware, userController.clearPlayHistory);
router.get   ("/top-genres",   authMiddleware, userController.getUserTopGenres);
router.get   ("/search",       authMiddleware, userController.search);

// ── Sessions ──────────────────────────────────────────────────────────────────
router.get   ("/sessions",     authMiddleware, userController.getSessions);
router.delete("/sessions/:id", authMiddleware, userController.deleteSession);

// ── Artist follows ────────────────────────────────────────────────────────────
router.get   ("/following/artists",       authMiddleware, userController.getFollowedArtists);
router.post  ("/artists/:id/follow",      authMiddleware, userController.followArtist);
router.delete("/artists/:id/follow",      authMiddleware, userController.unfollowArtist);

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

// ── Feedback / Suggestions ────────────────────────────────────────────────────
router.post("/feedback", authMiddleware, userController.submitFeedback);

// ── Song interactions ─────────────────────────────────────────────────────────
router.post("/songs/:id/rate",        authMiddleware, userController.rateSong);
router.post("/music/record-play/:id", authMiddleware, musicController.recordPlay);

// ── Lyrics ───────────────────────────────────────────────────────────────────
router.get ("/music/songs/:id/lyrics", musicController.getLyrics);

// ── Contact Us (public) ──────────────────────────────────────────────────────
router.post("/contact", async (req, res) => {
  const { name, email, category, message } = req.body;

  if (!name?.trim()) return res.status(400).json({ error: "Name is required" });
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return res.status(400).json({ error: "Valid email is required" });
  if (!message?.trim() || message.trim().length < 10)
    return res.status(400).json({ error: "Message must be at least 10 characters" });

  const categoryLabel = category || "General";

  try {
    const { sendEmail } = require('../utils/email');
    const html = `
      <div style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
        <div style="background:#07070f;padding:28px 36px 20px;">
          <p style="margin:0 0 4px;font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.2em;color:#C8FF00;">Muves · Contact Form</p>
          <h1 style="margin:0;font-size:22px;font-weight:900;color:#fff;letter-spacing:-.02em;">${categoryLabel}</h1>
        </div>
        <div style="padding:28px 36px;">
          <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:20px;">
            <tr style="background:#f8f8fb;">
              <td style="padding:10px 14px;color:#777;font-weight:600;width:90px;">From</td>
              <td style="padding:10px 14px;color:#111;">${name.trim()}</td>
            </tr>
            <tr>
              <td style="padding:10px 14px;color:#777;font-weight:600;">Email</td>
              <td style="padding:10px 14px;color:#111;">${email}</td>
            </tr>
            <tr style="background:#f8f8fb;">
              <td style="padding:10px 14px;color:#777;font-weight:600;">Category</td>
              <td style="padding:10px 14px;color:#111;">${categoryLabel}</td>
            </tr>
          </table>
          <div style="background:#f4f4f7;border-radius:10px;padding:16px 20px;font-size:15px;color:#222;line-height:1.6;white-space:pre-wrap;">${message.trim()}</div>
          <p style="margin:20px 0 0;font-size:12px;color:#999;">Reply directly to this email to respond to the user.</p>
        </div>
      </div>
    `;

    await sendEmail(
      'lijimailservice@gmail.com',
      `[Muves ${categoryLabel}] from ${name.trim()}`,
      `From: ${name.trim()} (${email})\nCategory: ${categoryLabel}\n\n${message.trim()}`,
      html
    );

    res.json({ message: "Message sent successfully" });
  } catch (error) {
    console.error("Contact form error:", error.message);
    res.status(500).json({ error: "Failed to send message. Please try again later." });
  }
});

module.exports = router;
