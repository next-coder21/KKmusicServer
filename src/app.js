require("dotenv").config();

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const cookieParser = require("cookie-parser");
const path = require("path");
const {
  globalLimiter, apiLimiter, adminLimiter,
  authLimiter, adminAuthLimiter, contactLimiter,
} = require("./middleware/rateLimiter");

const authRoutes = require("./routes/authRoutes");
const musicRoutes = require("./routes/musicRoutes");
const queueRoutes = require("./routes/queueRoutes");
const favouriteRoute = require("./routes/favouriteRoutes");
const adminRoutes = require("./routes/adminRoutes");

const app = express();

// ───────────────────────────────────────────────────────────────
// Trust proxy — required for secure cookies behind Render/Vercel
// ───────────────────────────────────────────────────────────────
app.set("trust proxy", 1);

// ───────────────────────────────────────────────────────────────
// Security headers
// ───────────────────────────────────────────────────────────────
app.use(
  helmet({
    // We serve audio cross-origin to the SPA; relax CORP defaults.
    crossOriginResourcePolicy: { policy: "cross-origin" },
    // CSP is best configured at the CDN/edge for a JSON API.
    contentSecurityPolicy: false,
  })
);

// ───────────────────────────────────────────────────────────────
// CORS — origins come from env. Always allows local dev ports.
//   CORS_ORIGIN=https://app.muves.in,https://muves.in,...
// ───────────────────────────────────────────────────────────────
const envOrigins = (process.env.CORS_ORIGIN || "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

const devOrigins = [
  "http://localhost:5173",
  "http://localhost:5174",
  "http://localhost:3000",
  "http://localhost:3030",
];

const allowedOrigins = new Set([...envOrigins, ...devOrigins]);

app.use(
  cors({
    origin: (origin, callback) => {
      // Same-origin requests, curl, server-to-server: no Origin header.
      if (!origin) return callback(null, true);
      if (allowedOrigins.has(origin)) return callback(null, true);
      // Permit any *.vercel.app preview deployment to ease iteration.
      if (/\.vercel\.app$/.test(new URL(origin).hostname)) {
        return callback(null, true);
      }
      console.warn(`[CORS] Blocked origin: ${origin}`);
      return callback(new Error(`CORS blocked: ${origin}`));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// ───────────────────────────────────────────────────────────────
// Body / cookie parsing
// ───────────────────────────────────────────────────────────────
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));
app.use(cookieParser());

// ───────────────────────────────────────────────────────────────
// Rate limiting — Redis-backed, alert emails on breach
// Tightest limiters registered first (Express matches in order)
// ───────────────────────────────────────────────────────────────
app.use("/admin/login",       adminAuthLimiter);
app.use("/auth/login",        authLimiter);
app.use("/auth/register",     authLimiter);
app.use("/auth/contact",      contactLimiter);
app.use("/admin",             adminLimiter);
app.use("/auth",              apiLimiter);
app.use(globalLimiter);       // catch-all safety net

// ───────────────────────────────────────────────────────────────
// Static files — cover images served directly (no auth needed)
// ───────────────────────────────────────────────────────────────
app.use("/covers", express.static(path.join(__dirname, "../public/covers"), {
  maxAge: "7d",
  setHeaders: (res) => {
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
  },
}));

// ───────────────────────────────────────────────────────────────
// Routes
// ───────────────────────────────────────────────────────────────
app.use("/auth", authRoutes);
app.use("/auth/music", musicRoutes);
app.use("/auth/queue", queueRoutes);
app.use("/auth", favouriteRoute);
app.use("/admin", adminRoutes);

// Root alive check
app.get("/", (_req, res) =>
  res.json({ status: "alive", service: "KKaudioBk — Muves Backend", uptime: process.uptime(), ts: Date.now() })
);

// Health check (used by uptime monitors / orchestrators).
app.get("/health", (_req, res) =>
  res.json({ status: "ok", uptime: process.uptime(), ts: Date.now() })
);

// App version check — mobile clients poll this on startup to detect updates.
// Configure on Render via env vars:
//   APP_VERSION        e.g. "1.0.1"
//   APP_VERSION_CODE   e.g. 2
//   APP_APK_URL        direct download link to the latest APK
//   APP_UPDATE_MESSAGE short release notes shown in the update prompt
//   APP_FORCE_UPDATE   "true" to block the app until updated
app.get("/version", (_req, res) => {
  res.json({
    version:      process.env.APP_VERSION      || "1.0.0",
    versionCode:  parseInt(process.env.APP_VERSION_CODE || "1", 10),
    apkUrl:       process.env.APP_APK_URL      || null,
    message:      process.env.APP_UPDATE_MESSAGE || "Bug fixes and improvements.",
    forceUpdate:  process.env.APP_FORCE_UPDATE === "true",
  });
});

// 404 fallback (only fires for routes the router didn't match).
app.use((req, res) => {
  res.status(404).json({ error: `Not found: ${req.method} ${req.path}` });
});

// ───────────────────────────────────────────────────────────────
// Centralised error handler
// ───────────────────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  const status = err.status || err.statusCode || 500;
  // Log the full error server-side, but never leak stack to clients.
  console.error(`[Error ${status}] ${req.method} ${req.path}:`, err);
  res.status(status).json({
    error: status >= 500
      ? "Internal Server Error"
      : err.message || "Request failed",
  });
});

module.exports = app;
