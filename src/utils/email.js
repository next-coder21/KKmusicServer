const https = require('https');
require('dotenv').config();

const MAIL_ENGINE_URL = process.env.MAIL_ENGINE_URL || 'https://lsmailengine.onrender.com';
const MAIL_API_KEY = process.env.MAIL_API_KEY || 'dandanakka-danakanakka';
const TIMEOUT_MS = 60000; // 60s to handle Render cold starts (~50s)

function httpPost(path, payload) {
  return new Promise((resolve, reject) => {
    const url = new URL(MAIL_ENGINE_URL + path);
    const body = JSON.stringify(payload);
    const options = {
      hostname: url.hostname,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'Authorization': `Bearer ${MAIL_API_KEY}`,
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(JSON.parse(data));
        } else {
          reject(new Error(`Mail engine responded ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(TIMEOUT_MS, () => {
      req.destroy(new Error('Mail engine request timed out'));
    });

    req.write(body);
    req.end();
  });
}

// Wake the mail engine (Render cold start), then send
exports.sendEmail = async (to, subject, body, htmlBody = null) => {
  const payload = {
    to,
    subject,
    html: htmlBody || `<p>${body}</p>`,
    text: body,
  };

  // Retry once in case the first attempt hits cold start and fails
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const result = await httpPost('/send', payload);
      console.log(`✅ Email sent to ${to}: ${result.messageId}`);
      return result;
    } catch (err) {
      if (attempt === 2) throw err;
      console.warn(`⚠️ Mail engine attempt ${attempt} failed (${err.message}), retrying...`);
      await new Promise((r) => setTimeout(r, 5000)); // wait 5s before retry
    }
  }
};
