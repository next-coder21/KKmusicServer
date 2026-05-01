const app = require("./app");

const PORT = Number(process.env.PORT) || 5000;
const ENV  = process.env.NODE_ENV || "development";

// Fail fast if critical env vars are missing in production.
if (ENV === "production") {
  const required = ["DATABASE_URL", "JWT_SECRET"];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length) {
    console.error(
      `[Startup] Missing required env vars in production: ${missing.join(", ")}`
    );
    process.exit(1);
  }
}

const server = app.listen(PORT, () => {
  console.log(`▶ KKaudioBk listening on :${PORT}  (env: ${ENV})`);
});

// Graceful shutdown — let in-flight requests finish before exiting.
const shutdown = (signal) => {
  console.log(`\n[${signal}] received — shutting down…`);
  server.close((err) => {
    if (err) {
      console.error("[Shutdown] error:", err);
      process.exit(1);
    }
    console.log("[Shutdown] complete.");
    process.exit(0);
  });
  // Hard exit if shutdown hangs longer than 10s.
  setTimeout(() => process.exit(1), 10_000).unref();
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

// Crash loudly on unexpected errors so the orchestrator can restart us.
process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection]", reason);
});
process.on("uncaughtException", (err) => {
  console.error("[uncaughtException]", err);
  process.exit(1);
});
