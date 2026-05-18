/**
 * smoke.js — Pre-beta smoke test suite for the Muves / KKaudioBk API
 *
 * Run:  node test/smoke.js
 * Requires Node 18+ (built-in fetch).
 * Set TEST_EMAIL / TEST_PASSWORD env vars to use real credentials,
 * otherwise the auth-required tests will be skipped gracefully.
 *
 * Exit code 0 = all assertions passed.
 * Exit code 1 = one or more assertions failed.
 */

"use strict";

const BASE = process.env.BASE_URL || "http://localhost:5000";

// ─── Credentials (override via env) ──────────────────────────────────────────
const VALID_EMAIL    = process.env.TEST_EMAIL    || "test@muves.in";
const VALID_PASSWORD = process.env.TEST_PASSWORD || "TestPass123";

// ─── Tiny assertion / reporting helpers ──────────────────────────────────────
let passed = 0;
let failed = 0;
const failures = [];

function assert(label, condition, detail = "") {
  if (condition) {
    console.log(`  ✔  ${label}`);
    passed++;
  } else {
    const msg = detail ? `${label} — ${detail}` : label;
    console.error(`  ✘  ${msg}`);
    failed++;
    failures.push(msg);
  }
}

function section(title) {
  console.log(`\n${"─".repeat(60)}`);
  console.log(`  ${title}`);
  console.log("─".repeat(60));
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────
async function api(method, path, { body, token, headers = {} } = {}) {
  const opts = {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    // Don't follow redirects blindly; we just want the raw status
    redirect: "follow",
  };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(`${BASE}${path}`, opts);
  let json = null;
  try { json = await res.json(); } catch { /* streaming or non-JSON response */ }
  return { status: res.status, json, headers: res.headers };
}

// ─── Login helper (returns token or null) ────────────────────────────────────
async function loginAs(email, password) {
  try {
    const { status, json } = await api("POST", "/auth/login", {
      body: { email, password },
    });
    if (status === 200 && json?.token) return json.token;
  } catch {}
  return null;
}

// ─── Main ─────────────────────────────────────────────────────────────────────
(async () => {
  console.log(`\nMuves API Smoke Test`);
  console.log(`Base URL : ${BASE}`);
  console.log(`Date     : ${new Date().toISOString()}\n`);

  // ── 1. Health check ─────────────────────────────────────────────────────────
  section("1. Health check");
  {
    const { status, json } = await api("GET", "/health");
    assert("GET /health → 200", status === 200, `got ${status}`);
    assert("health.status === 'ok'", json?.status === "ok", JSON.stringify(json));
  }

  // ── 2. POST /auth/login ──────────────────────────────────────────────────────
  section("2. POST /auth/login");
  let authToken = null;
  {
    // 2a — missing both fields
    const r1 = await api("POST", "/auth/login", { body: {} });
    assert(
      "Missing email+password → 401 or 400",
      r1.status === 400 || r1.status === 401,
      `got ${r1.status}`
    );

    // 2b — missing password
    const r2 = await api("POST", "/auth/login", { body: { email: VALID_EMAIL } });
    assert(
      "Missing password → 401 or 400",
      r2.status === 400 || r2.status === 401,
      `got ${r2.status}`
    );

    // 2c — invalid credentials
    const r3 = await api("POST", "/auth/login", {
      body: { email: "nobody@nowhere.xyz", password: "WrongPass999" },
    });
    assert("Invalid creds → 401", r3.status === 401, `got ${r3.status}`);
    assert(
      "Invalid creds: no user-enumeration leak (message must be generic)",
      ["Invalid email or password", "Invalid credentials"].includes(r3.json?.error),
      `got "${r3.json?.error}"`
    );

    // 2d — wrong password for valid-looking email
    const r4 = await api("POST", "/auth/login", {
      body: { email: VALID_EMAIL, password: "definitelyWrong!" },
    });
    assert("Wrong password → 401", r4.status === 401 || r4.status === 400, `got ${r4.status}`);

    // 2e — valid credentials (if configured)
    authToken = await loginAs(VALID_EMAIL, VALID_PASSWORD);
    if (authToken) {
      assert("Valid login → token received", typeof authToken === "string" && authToken.length > 10);
      // Password must NOT appear in login response
      const loginRes = await api("POST", "/auth/login", {
        body: { email: VALID_EMAIL, password: VALID_PASSWORD },
      });
      const bodyStr = JSON.stringify(loginRes.json);
      assert(
        "Login response does not include password hash",
        !bodyStr.includes('"password"') && !bodyStr.match(/\$2[ab]\$/),
        "password field leaked in response"
      );
    } else {
      console.log("  ℹ  Skipping valid-login assertions (TEST_EMAIL/TEST_PASSWORD not set or wrong)");
    }
  }

  // ── 3. GET /auth/check-auth (acts as /profile) ───────────────────────────────
  section("3. GET /auth/check-auth (profile)");
  {
    // Without token
    const r1 = await api("GET", "/auth/check-auth");
    assert("No token → 401", r1.status === 401, `got ${r1.status}`);

    if (authToken) {
      const r2 = await api("GET", "/auth/check-auth", { token: authToken });
      assert("With token → 200", r2.status === 200, `got ${r2.status}`);
      assert("Profile has user object", r2.json?.user !== undefined, JSON.stringify(r2.json));
      assert(
        "Profile response does not include password",
        !JSON.stringify(r2.json).includes('"password"'),
        "password field in profile"
      );
    }
  }

  // ── 4. POST /auth/refresh-token ──────────────────────────────────────────────
  section("4. POST /auth/refresh-token");
  {
    // This endpoint does not exist in the current router — should return 404 not 500
    const r1 = await api("POST", "/auth/refresh-token");
    assert(
      "Missing/non-existent refresh-token → 404 or 401 (not 500)",
      r1.status !== 500,
      `got ${r1.status} — a 500 here indicates an unhandled crash`
    );
  }

  // ── 5. GET /auth/music/songs ─────────────────────────────────────────────────
  section("5. GET /auth/music/songs");
  {
    // This route has no authMiddleware — public
    const r1 = await api("GET", "/auth/music/songs");
    assert(
      "No token → 200 (public route)",
      r1.status === 200,
      `got ${r1.status}`
    );
    assert("Response is an array", Array.isArray(r1.json), `got ${typeof r1.json}`);
  }

  // ── 6. GET /auth/music/stream/:id ────────────────────────────────────────────
  section("6. GET /auth/music/stream/:id");
  {
    // This route is intentionally public (no authMiddleware in musicRoutes.js)
    // We test: existing ID returns 200/206, non-existing returns 404, never 500 on bad id
    const r1 = await api("GET", "/auth/music/stream/00000000-0000-0000-0000-000000000000");
    assert(
      "Unknown UUID → 404 (not 500)",
      r1.status === 404,
      `got ${r1.status}`
    );

    // If we have songs, test with a real one
    const songs = await api("GET", "/auth/music/songs");
    if (Array.isArray(songs.json) && songs.json.length > 0) {
      const firstId = songs.json[0].id;
      // Use Range header so we only fetch 1 byte — avoids downloading full audio
      const r2 = await fetch(`${BASE}/auth/music/stream/${firstId}`, {
        headers: { Range: "bytes=0-0" },
      });
      assert(
        `Stream first song (id=${firstId}) → 200/206 (not 401/500)`,
        r2.status === 200 || r2.status === 206,
        `got ${r2.status}`
      );
      await r2.body?.cancel().catch(() => {});
    } else {
      console.log("  ℹ  No songs in DB — skipping live stream test");
    }
  }

  // ── 7. GET /auth/search?q=test ────────────────────────────────────────────────
  section("7. GET /auth/search?q=test (with token)");
  {
    // Without token
    const r1 = await api("GET", "/auth/search?q=test");
    assert("No token → 401", r1.status === 401, `got ${r1.status}`);

    if (authToken) {
      const r2 = await api("GET", "/auth/search?q=test", { token: authToken });
      assert("With token → 200", r2.status === 200, `got ${r2.status}`);
      assert(
        "Response has songs/artists/albums keys",
        r2.json?.songs !== undefined && r2.json?.artists !== undefined,
        JSON.stringify(r2.json)
      );
    }
  }

  // ── 8. POST /auth/music/record-play/:id ──────────────────────────────────────
  // (This is the closest analogue to "recently-played" — POST with token/invalid body)
  section("8. POST /auth/music/record-play/:id (recently-played)");
  {
    // Without token
    const r1 = await api("POST", "/auth/music/record-play/00000000-0000-0000-0000-000000000000");
    assert("No token → 401", r1.status === 401, `got ${r1.status}`);

    if (authToken) {
      // Invalid / non-existent song id — should not 500
      const r2 = await api(
        "POST",
        "/auth/music/record-play/00000000-0000-0000-0000-000000000000",
        { token: authToken }
      );
      assert(
        "Record-play with bad id → not 500 (graceful)",
        r2.status !== 500,
        `got ${r2.status}`
      );
    }
  }

  // ── 9. GET /auth/playlists ────────────────────────────────────────────────────
  section("9. GET /auth/playlists");
  {
    // Without token
    const r1 = await api("GET", "/auth/playlists");
    assert("No token → 401", r1.status === 401, `got ${r1.status}`);

    if (authToken) {
      const r2 = await api("GET", "/auth/playlists", { token: authToken });
      assert("With token → 200", r2.status === 200, `got ${r2.status}`);
      assert("Response is an array", Array.isArray(r2.json), `got ${typeof r2.json}`);
    }
  }

  // ── 10. POST /auth/forgot-password (verify-security) ─────────────────────────
  section("10. POST /auth/verify-security (forgot-password flow)");
  {
    // Invalid email format
    const r1 = await api("POST", "/auth/verify-security", {
      body: { email: "not-an-email", securityAnswer: "whatever" },
    });
    assert(
      "Invalid email → 400 or 401 (not 500)",
      r1.status === 400 || r1.status === 401,
      `got ${r1.status}`
    );

    // Non-existent email
    const r2 = await api("POST", "/auth/verify-security", {
      body: { email: "nobody@nowhere.xyz", securityAnswer: "keyword" },
    });
    assert(
      "Non-existent email → 400 (not 500)",
      r2.status === 400 || r2.status === 404,
      `got ${r2.status}`
    );

    // Missing fields
    const r3 = await api("POST", "/auth/verify-security", { body: {} });
    assert(
      "Missing fields → 400",
      r3.status === 400,
      `got ${r3.status}`
    );
  }

  // ── 11. POST /auth/logout ─────────────────────────────────────────────────────
  section("11. POST /auth/logout");
  {
    const r = await api("POST", "/auth/logout");
    assert("Logout → 200", r.status === 200, `got ${r.status}`);
    assert("Logout message present", r.json?.message !== undefined, JSON.stringify(r.json));

    // Verify cookie is cleared in response
    const setCookie = r.headers.get("set-cookie") || "";
    const cookieCleared =
      setCookie.includes("token=;") ||
      setCookie.includes("token=") && (
        setCookie.toLowerCase().includes("expires=thu, 01 jan 1970") ||
        setCookie.toLowerCase().includes("max-age=0")
      );
    assert(
      "Logout clears token cookie (set-cookie header present with empty/expired token)",
      cookieCleared,
      `set-cookie: ${setCookie || "(none)"}`
    );
  }

  // ── 12. 404 on unknown route ──────────────────────────────────────────────────
  section("12. 404 on unknown route");
  {
    const r = await api("GET", "/this/does/not/exist/at/all");
    assert("Unknown route → 404", r.status === 404, `got ${r.status}`);
    assert("404 body has error field", r.json?.error !== undefined, JSON.stringify(r.json));
  }

  // ── 13. Security header checks ────────────────────────────────────────────────
  section("13. Security headers (helmet)");
  {
    const { headers } = await api("GET", "/health");
    assert(
      "X-Content-Type-Options: nosniff",
      (headers.get("x-content-type-options") || "").toLowerCase().includes("nosniff"),
      headers.get("x-content-type-options")
    );
    assert(
      "X-Frame-Options present",
      !!headers.get("x-frame-options"),
      "(missing)"
    );
  }

  // ── Summary ───────────────────────────────────────────────────────────────────
  console.log(`\n${"═".repeat(60)}`);
  console.log(`  RESULTS:  ${passed} passed,  ${failed} failed`);
  if (failures.length) {
    console.log("\n  FAILED ASSERTIONS:");
    failures.forEach((f) => console.error(`    • ${f}`));
  }
  console.log("═".repeat(60) + "\n");

  process.exit(failed > 0 ? 1 : 0);
})().catch((err) => {
  console.error("\nFATAL — could not connect to server:", err.message);
  console.error("Is the server running on", BASE, "?");
  process.exit(1);
});
