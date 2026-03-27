const pool = require('./src/models/User');

async function test() {
  try {
    const type = undefined;
    const status = 'scheduled';
    const limit = 20;
    const offset = 0;

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

    console.log("Query:", query);
    console.log("Params:", params);

    const { rows } = await pool.query(query, params);
    console.log("Success, rows:", rows.length);
    process.exit(0);
  } catch (e) {
    console.error("FAILED WITH ERROR:");
    console.error(e);
    process.exit(1);
  }
}

test();
