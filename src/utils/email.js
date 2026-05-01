const https = require('https');
require('dotenv').config();

const MAIL_ENGINE_URL = process.env.MAIL_ENGINE_URL || 'https://lsmailengine.onrender.com';
const MAIL_API_KEY = process.env.MAIL_API_KEY || 'dandanakka-danakanakka';

exports.sendEmail = async (to, subject, body, htmlBody = null) => {
  const payload = JSON.stringify({
    to,
    subject,
    html: htmlBody || `<p>${body}</p>`,
    text: body,
  });

  return new Promise((resolve, reject) => {
    const url = new URL(`${MAIL_ENGINE_URL}/send`);
    const options = {
      hostname: url.hostname,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'Authorization': `Bearer ${MAIL_API_KEY}`,
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          const result = JSON.parse(data);
          console.log(`✅ Email sent to ${to}: ${result.messageId}`);
          resolve(result);
        } else {
          reject(new Error(`Mail engine error ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(15000, () => {
      req.destroy(new Error('Mail engine request timed out'));
    });

    req.write(payload);
    req.end();
  });
};
