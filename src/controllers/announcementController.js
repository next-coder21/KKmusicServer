const pool = require('../models/User');
const multer = require('multer');
const { sendEmail } = require('../utils/email');

// Helper to validate UUID
const isValidUUID = (id) => {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-5][0-9a-f]{3}-[089ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
};

// Configure Multer for memory storage
const storage = multer.memoryStorage();
exports.upload = multer({ 
  storage: storage,
  limits: { fileSize: 2 * 1024 * 1024 } // 2MB limit
}).single('image');

exports.getAnnouncements = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;
    const { type, status } = req.query;

    let query = `
      SELECT a.*, au.name as creator_name 
      FROM announcements a
      LEFT JOIN admin_users au ON a.created_by = au.id
      WHERE 1=1
    `;
    const params = [];

    if (type) {
      params.push(type);
      query += ` AND a.type = $${params.length}`;
    }

    if (status) {
      if (status === 'draft') {
        query += ` AND a.is_published = FALSE AND a.scheduled_at IS NULL`;
      } else if (status === 'scheduled') {
        query += ` AND a.is_published = TRUE AND a.sent_at IS NULL AND a.scheduled_at > NOW()`;
      } else if (status === 'published' || status === 'sent') {
        query += ` AND a.sent_at IS NOT NULL`;
      }
    }

    query += ` ORDER BY a.sent_at DESC NULLS LAST, a.scheduled_at ASC NULLS LAST, a.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const { rows } = await pool.query(query, params);
    
    // Get total count matching same filters
    let countQuery = `SELECT COUNT(*) FROM announcements a WHERE 1=1`;
    const countParams = [];
    if (type) {
      countParams.push(type);
      countQuery += ` AND a.type = $1`;
    }
    if (status) {
      if (status === 'draft') {
        countQuery += ` AND a.is_published = FALSE AND a.scheduled_at IS NULL`;
      } else if (status === 'scheduled') {
        countQuery += ` AND a.is_published = TRUE AND a.sent_at IS NULL AND a.scheduled_at > NOW()`;
      } else if (status === 'published' || status === 'sent') {
        countQuery += ` AND a.sent_at IS NOT NULL`;
      }
    }
    
    const countRes = await pool.query(countQuery, countParams);

    res.json({
      announcements: rows,
      total: parseInt(countRes.rows[0].count),
      page,
      limit
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch announcements" });
  }
};

exports.getAnnouncementById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidUUID(id)) return res.status(400).json({ error: "Invalid announcement ID" });

    const { rows } = await pool.query(
      'SELECT a.*, au.name as creator_name FROM announcements a LEFT JOIN admin_users au ON a.created_by = au.id WHERE a.id = $1',
      [id]
    );
    if (rows.length === 0) return res.status(404).json({ error: "Announcement not found" });
    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch announcement" });
  }
};

exports.createAnnouncement = async (req, res) => {
  try {
    const { title, body, type, target, target_emails, action_url, action_label, scheduled_at } = req.body;
    let image_url = req.body.image_url || null;

    if (req.file) {
      const base64Image = req.file.buffer.toString('base64');
      image_url = `data:${req.file.mimetype};base64,${base64Image}`;
    }

    const emails = target_emails ? JSON.parse(target_emails) : null;

    const { rows } = await pool.query(
      `INSERT INTO announcements 
       (title, body, type, target, target_emails, action_url, action_label, scheduled_at, image_url, created_by) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) 
       RETURNING *`,
      [title, body, type, target, emails, action_url, action_label, scheduled_at || null, image_url, req.admin.adminId]
    );

    res.json(rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to create announcement" });
  }
};

exports.updateAnnouncement = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidUUID(id)) return res.status(400).json({ error: "Invalid announcement ID" });

    const check = await pool.query('SELECT sent_at FROM announcements WHERE id = $1', [id]);
    if (check.rows.length === 0) return res.status(404).json({ error: "Announcement not found" });
    if (check.rows[0].sent_at) return res.status(400).json({ error: "Cannot update a sent announcement" });

    const { title, body, type, target, target_emails, action_url, action_label, scheduled_at } = req.body;
    let image_url = req.body.image_url; // Default to existing or provided URL

    if (req.file) {
      const base64Image = req.file.buffer.toString('base64');
      image_url = `data:${req.file.mimetype};base64,${base64Image}`;
    }

    const emails = target_emails ? (typeof target_emails === 'string' ? JSON.parse(target_emails) : target_emails) : null;

    const { rows } = await pool.query(
      `UPDATE announcements 
       SET title = $1, body = $2, type = $3, target = $4, target_emails = $5, 
           action_url = $6, action_label = $7, scheduled_at = $8, image_url = $9, updated_at = NOW()
       WHERE id = $10 RETURNING *`,
      [title, body, type, target, emails, action_url, action_label, scheduled_at || null, image_url, id]
    );

    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: "Failed to update announcement" });
  }
};

exports.deleteAnnouncement = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidUUID(id)) return res.status(400).json({ error: "Invalid announcement ID" });

    const check = await pool.query('SELECT sent_at FROM announcements WHERE id = $1', [id]);
    if (check.rows.length === 0) return res.status(404).json({ error: "Announcement not found" });
    if (check.rows[0].sent_at) return res.status(400).json({ error: "Cannot delete a sent announcement" });

    await pool.query('DELETE FROM announcements WHERE id = $1', [id]);
    res.json({ message: "Announcement deleted successfully" });
  } catch (error) {
    res.status(500).json({ error: "Failed to delete announcement" });
  }
};

exports.publishAnnouncement = async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    if (!isValidUUID(id)) throw new Error("Invalid announcement ID");
    
    await client.query('BEGIN');

    const { rows } = await client.query('SELECT * FROM announcements WHERE id = $1', [id]);
    if (rows.length === 0) throw new Error("Announcement not found");
    const announcement = rows[0];

    if (announcement.sent_at) throw new Error("Already published");
    
    const notificationTitle = announcement.title;
    const notificationBody = announcement.body;
    const notificationType = announcement.type;
    const actionUrl = announcement.action_url;
    let notifiedCount = 0;

    // Atomic update
    await client.query(
      'UPDATE announcements SET is_published = TRUE, sent_at = NOW(), updated_at = NOW() WHERE id = $1',
      [id]
    );

    let recipients = [];
    if (announcement.target === 'all') {
      const usersRes = await client.query('SELECT email FROM users WHERE is_active = TRUE');
      recipients = usersRes.rows.map(r => r.email);
    } else if (announcement.target === 'verified') {
      const usersRes = await client.query('SELECT email FROM users WHERE is_active = TRUE AND is_verified = TRUE');
      recipients = usersRes.rows.map(r => r.email);
    } else if (announcement.target === 'specific' && announcement.target_emails) {
      recipients = announcement.target_emails;
    }

    // Prepare CID attachment if image is base64
    let attachments = [];
    let displayImageUrl = announcement.image_url;

    if (announcement.image_url && announcement.image_url.startsWith('data:')) {
      const matches = announcement.image_url.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
      if (matches && matches.length === 3) {
        const contentType = matches[1];
        const base64Data = matches[2];
        attachments.push({
          filename: 'banner',
          content: Buffer.from(base64Data, 'base64'),
          cid: 'announcement_banner',
          contentType
        });
        displayImageUrl = 'cid:announcement_banner';
      }
    }

    // Convert plain-text body into proper HTML paragraphs:
    // Split on blank lines → <p> blocks; single newlines → <br>
    const bodyHtml = notificationBody
      .split(/\n{2,}/)                          // blank line = new paragraph
      .map(para =>
        `<p style="color:#555;line-height:1.8;margin:0 0 14px 0;">${
          para.trim().replace(/\n/g, '<br>')      // single newline = <br>
        }</p>`
      )
      .join('');

    const emailHtml = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8"/>
        <meta name="viewport" content="width=device-width,initial-scale=1"/>
      </head>
      <body style="margin:0;padding:0;background:#f4f4f7;">
        <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f7;padding:32px 0;">
          <tr><td align="center">
            <table width="600" cellpadding="0" cellspacing="0"
              style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08);">

              ${displayImageUrl ? `
              <tr>
                <td>
                  <img src="${displayImageUrl}"
                    style="width:100%;max-height:280px;object-fit:cover;display:block;" />
                </td>
              </tr>` : ''}

              <!-- Header accent bar -->
              <tr>
                <td style="height:4px;background:linear-gradient(90deg,#6c5ce7,#ec4899);"></td>
              </tr>

              <!-- Body -->
              <tr>
                <td style="padding:32px 36px 24px;">
                  <!-- Type badge -->
                  <p style="margin:0 0 10px;font-size:11px;font-weight:700;
                    text-transform:uppercase;letter-spacing:.1em;color:#6c5ce7;
                    font-family:sans-serif;">
                    ${announcement.type || 'Announcement'} · KK Music Team
                  </p>

                  <!-- Title -->
                  <h1 style="margin:0 0 20px;font-size:22px;font-weight:800;
                    color:#111;line-height:1.3;font-family:sans-serif;">
                    ${notificationTitle}
                  </h1>

                  <!-- Body paragraphs -->
                  <div style="font-family:sans-serif;font-size:15px;">
                    ${bodyHtml}
                  </div>

                  ${announcement.action_url ? `
                  <div style="margin-top:28px;text-align:center;">
                    <a href="${announcement.action_url}"
                      style="display:inline-block;padding:13px 30px;
                        background:linear-gradient(135deg,#6c5ce7,#ec4899);
                        color:#fff;text-decoration:none;border-radius:8px;
                        font-weight:700;font-size:14px;font-family:sans-serif;
                        letter-spacing:.02em;">
                      ${announcement.action_label || 'Learn More'}
                    </a>
                  </div>` : ''}
                </td>
              </tr>

              <!-- Footer -->
              <tr>
                <td style="padding:18px 36px;background:#f9f8ff;
                  border-top:1px solid #eee;text-align:center;
                  font-family:sans-serif;font-size:12px;color:#999;">
                  You received this because you are part of our exclusive listener list.<br/>
                  <span style="color:#bbb;">© ${new Date().getFullYear()} KK Music · Muves</span>
                </td>
              </tr>

            </table>
          </td></tr>
        </table>
      </body>
      </html>
    `;

    for (const email of recipients) {
      // 1. Send In-App Notification
      await client.query(
        `INSERT INTO notifications (user_email, type, title, body, action_url)
         VALUES ($1, $2, $3, $4, $5)`,
        [email, notificationType, notificationTitle, notificationBody, actionUrl]
      );

      // 2. Send Real Email (Using CID attachments if present)
      try {
        await sendEmail(email, notificationTitle, notificationBody, emailHtml, attachments);
      } catch (err) {
        console.error(`Email failed for ${email}:`, err);
      }
      notifiedCount++;
    }

    await client.query('COMMIT');
    res.json({ message: "Announcement published successfully", notified_count: notifiedCount });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: error.message || "Failed to publish" });
  } finally {
    client.release();
  }
};

exports.previewAnnouncement = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidUUID(id)) return res.status(400).json({ error: "Invalid announcement ID" });

    const { rows } = await pool.query('SELECT * FROM announcements WHERE id = $1', [id]);
    if (rows.length === 0) return res.status(404).json({ error: "Not found" });
    
    const a = rows[0];
    res.json({
      preview: {
        type: a.type,
        title: a.title,
        body: a.body,
        image_url: a.image_url,
        action_url: a.action_url,
        action_label: a.action_label,
        target_summary: a.target === 'specific' ? `${a.target_emails.length} specific users` : a.target
      }
    });
  } catch (error) {
    res.status(500).json({ error: "Preview failed" });
  }
};

exports.getAnnouncementStats = async (req, res) => {
  try {
    const { id } = req.params;
    if (!isValidUUID(id)) return res.status(400).json({ error: "Invalid announcement ID" });

    // We assume notifications for an announcement can be identified by title + body + type sent around sent_at
    // But since we don't have an announcement_id in notifications table, we'll return mock/calculated stats
    // or we could add announcement_id to notifications. For now, let's count matching notifications.
    
    const { rows: annRows } = await pool.query('SELECT title, sent_at FROM announcements WHERE id = $1', [id]);
    if (annRows.length === 0 || !annRows[0].sent_at) return res.status(404).json({ error: "Sent announcement not found" });

    const { title, sent_at } = annRows[0];
    
    // Approximate matching (in a real app, you'd have a FK)
    const { rows } = await pool.query(
      `SELECT 
        COUNT(*) as total_sent,
        COUNT(*) FILTER (WHERE is_read = TRUE) as total_read
       FROM notifications 
       WHERE title = $1 AND created_at >= $2 - interval '5 minutes' AND created_at <= $2 + interval '5 minutes'`,
      [title, sent_at]
    );

    const stats = rows[0];
    const total_sent = parseInt(stats.total_sent);
    const total_read = parseInt(stats.total_read);
    const read_rate = total_sent > 0 ? (total_read / total_sent) * 100 : 0;

    res.json({
      total_sent,
      total_read,
      read_rate: read_rate.toFixed(1)
    });
  } catch (error) {
    res.status(500).json({ error: "Stats failed" });
  }
};
