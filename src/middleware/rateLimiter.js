const rateLimit = require('express-rate-limit');
const { getRedis, isRedisAvailable } = require('../config/redis');
const { sendEmail } = require('../utils/email');

const ALERT_RECIPIENTS = ['lijishwilson@gmail.com', 'lijishdon@gmail.com'];
const ALERT_COOLDOWN   = 10 * 60; // seconds — one alert per IP per limiter per 10 min

// ── Redis store for express-rate-limit ────────────────────────────────────────
// Fixed-window counter. Falls back to in-memory if Redis is unavailable.
class RedisStore {
  constructor(windowMs, prefix) {
    this.windowSeconds = Math.ceil(windowMs / 1000);
    this.prefix = prefix;
  }

  async increment(key) {
    if (!isRedisAvailable()) return this._memFallback(key);
    const r   = getRedis();
    const rk  = `${this.prefix}:${key}`;
    const hit = await r.incr(rk);
    if (hit === 1) await r.expire(rk, this.windowSeconds);
    const ttl       = await r.ttl(rk);
    const resetTime = new Date(Date.now() + Math.max(ttl, 0) * 1000);
    return { totalHits: hit, resetTime };
  }

  async decrement(key) {
    if (!isRedisAvailable()) return;
    await getRedis().decr(`${this.prefix}:${key}`).catch(() => {});
  }

  async resetKey(key) {
    if (!isRedisAvailable()) return;
    await getRedis().del(`${this.prefix}:${key}`).catch(() => {});
  }

  // Minimal in-memory fallback so the server keeps working without Redis
  _memFallback(key) {
    if (!this._mem) this._mem = new Map();
    const now  = Date.now();
    const entry = this._mem.get(key) || { hits: 0, reset: now + this.windowSeconds * 1000 };
    if (now > entry.reset) { entry.hits = 0; entry.reset = now + this.windowSeconds * 1000; }
    entry.hits += 1;
    this._mem.set(key, entry);
    return { totalHits: entry.hits, resetTime: new Date(entry.reset) };
  }
}

// ── Alert email ───────────────────────────────────────────────────────────────
async function sendSecurityAlert({ limiterName, ip, path, method, userAgent, totalHits, limit, windowLabel }) {
  const severityColor = totalHits >= limit * 3 ? '#ef4444' : '#f97316';
  const html = `
    <div style="font-family:Inter,system-ui,sans-serif;max-width:580px;margin:0 auto;background:#0a0a12;border:1px solid #1e1e2e;border-radius:12px;overflow:hidden;">
      <div style="background:linear-gradient(135deg,${severityColor},#dc2626);padding:20px 28px;">
        <h2 style="margin:0;color:#fff;font-size:16px;font-weight:700;letter-spacing:-0.02em;">
          🚨 Security Alert — Rate Limit Triggered (Muves API)
        </h2>
      </div>
      <div style="padding:24px 28px;">
        <p style="margin:0 0 16px;font-size:14px;color:#d1d5db;line-height:1.6;">
          A client has exceeded the <strong style="color:#fff;">${limiterName}</strong> rate limit.
          This may indicate a brute-force attempt, a scanner, or a misconfigured client.
        </p>
        <table style="width:100%;border-collapse:collapse;font-size:13px;background:#111120;border-radius:8px;overflow:hidden;margin-bottom:16px;">
          <tr>
            <td style="padding:10px 14px;color:#6b7280;font-weight:600;width:140px;">IP Address</td>
            <td style="padding:10px 14px;color:#f97316;font-weight:700;font-family:monospace;">${ip}</td>
          </tr>
          <tr style="background:#0d0d1a;">
            <td style="padding:10px 14px;color:#6b7280;font-weight:600;">Endpoint</td>
            <td style="padding:10px 14px;color:#fff;font-family:monospace;">${method} ${path}</td>
          </tr>
          <tr>
            <td style="padding:10px 14px;color:#6b7280;font-weight:600;">Requests</td>
            <td style="padding:10px 14px;color:${severityColor};font-weight:700;">${totalHits} / ${limit} limit</td>
          </tr>
          <tr style="background:#0d0d1a;">
            <td style="padding:10px 14px;color:#6b7280;font-weight:600;">Window</td>
            <td style="padding:10px 14px;color:#fff;">${windowLabel}</td>
          </tr>
          <tr>
            <td style="padding:10px 14px;color:#6b7280;font-weight:600;">Limiter</td>
            <td style="padding:10px 14px;color:#a78bfa;">${limiterName}</td>
          </tr>
          <tr style="background:#0d0d1a;">
            <td style="padding:10px 14px;color:#6b7280;font-weight:600;">User-Agent</td>
            <td style="padding:10px 14px;color:#9ca3af;font-family:monospace;font-size:11px;word-break:break-all;">${userAgent || 'Unknown'}</td>
          </tr>
          <tr>
            <td style="padding:10px 14px;color:#6b7280;font-weight:600;">Detected at</td>
            <td style="padding:10px 14px;color:#fff;">${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'full', timeStyle: 'medium' })} IST</td>
          </tr>
        </table>
        <p style="margin:0;font-size:12px;color:#6b7280;line-height:1.5;">
          The request has been blocked with HTTP 429. This alert fires once per 10-minute window per IP.
          If this IP persists, consider blocking it at the firewall/reverse-proxy level.
        </p>
        <p style="margin:12px 0 0;font-size:11px;color:#4b5563;">Automated security alert · Muves / KK Music Platform</p>
      </div>
    </div>
  `;

  await Promise.allSettled(
    ALERT_RECIPIENTS.map((to) =>
      sendEmail(
        to,
        `🚨 Security Alert — ${limiterName} rate limit hit by ${ip}`,
        `Rate limit exceeded by IP ${ip} on ${method} ${path}. Hits: ${totalHits}/${limit}.`,
        html,
      ).catch((e) => console.error(`[RateLimit] alert email to ${to} failed:`, e.message))
    )
  );
}

// ── Alert throttle: one email per IP per limiter per 10-minute window ──────────
async function shouldAlert(limiterName, ip) {
  const key = `muves:rl:alerted:${limiterName}:${ip}:${Math.floor(Date.now() / 1000 / ALERT_COOLDOWN)}`;
  if (!isRedisAvailable()) return true; // no Redis → always alert (may be noisy, acceptable)
  try {
    const set = await getRedis().set(key, '1', 'EX', ALERT_COOLDOWN + 60, 'NX');
    return set === 'OK'; // OK = key didn't exist = first alert this window
  } catch { return false; }
}

// ── Handler factory ───────────────────────────────────────────────────────────
function makeHandler(limiterName, windowLabel) {
  return async (req, res, _next, options) => {
    const ip        = req.ip || req.socket?.remoteAddress || 'unknown';
    const userAgent = req.headers['user-agent'];
    const totalHits = res.getHeader('RateLimit-Current') || options.max + 1;

    console.warn(`[RateLimit:${limiterName}] ${ip} — ${req.method} ${req.path} — hits: ${totalHits}`);

    if (await shouldAlert(limiterName, ip)) {
      sendSecurityAlert({
        limiterName,
        ip,
        path:   req.path,
        method: req.method,
        userAgent,
        totalHits,
        limit:  options.max,
        windowLabel,
      }); // fire-and-forget
    }

    res.status(options.statusCode).json({ error: options.message.error });
  };
}

// ── Limiter factory ───────────────────────────────────────────────────────────
function makeLimiter({ name, windowMs, max, prefix }) {
  const windowMins  = Math.round(windowMs / 60_000);
  const windowLabel = `${windowMins} minute${windowMins !== 1 ? 's' : ''}`;

  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders:   false,
    store: new RedisStore(windowMs, `muves:rl:${prefix}`),
    handler: makeHandler(name, windowLabel),
    message: { error: `Too many requests. Limit: ${max} per ${windowLabel}.` },
    skip: (req) => {
      // Never rate-limit health/version endpoints — uptime monitors need these
      return req.path === '/health' || req.path === '/';
    },
  });
}

// ── Named limiters ────────────────────────────────────────────────────────────
//  Tiers from loosest to tightest:
//
//  global   — baseline safety net for all routes
//  api      — authenticated API calls (music, queue, favourites)
//  admin    — admin panel endpoints
//  auth     — login / register / OTP  (brute-force target)
//  contact  — contact form (spam target)

const globalLimiter = makeLimiter({
  name:      'global',
  windowMs:  15 * 60 * 1000,   // 15 min
  max:       300,               // generous for normal users
  prefix:    'global',
});

const apiLimiter = makeLimiter({
  name:      'api',
  windowMs:  1 * 60 * 1000,    // 1 min
  max:       60,
  prefix:    'api',
});

const adminLimiter = makeLimiter({
  name:      'admin',
  windowMs:  15 * 60 * 1000,
  max:       120,               // admins do bulk operations
  prefix:    'admin',
});

const authLimiter = makeLimiter({
  name:      'auth',
  windowMs:  15 * 60 * 1000,
  max:       15,                // 15 login/register attempts per 15 min
  prefix:    'auth',
});

const adminAuthLimiter = makeLimiter({
  name:      'admin-auth',
  windowMs:  15 * 60 * 1000,
  max:       8,                 // admin login is high-value target
  prefix:    'admin-auth',
});

const contactLimiter = makeLimiter({
  name:      'contact',
  windowMs:  15 * 60 * 1000,
  max:       5,
  prefix:    'contact',
});

module.exports = {
  globalLimiter,
  apiLimiter,
  adminLimiter,
  authLimiter,
  adminAuthLimiter,
  contactLimiter,
};
