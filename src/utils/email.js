const nodemailer = require('nodemailer');
require('dotenv').config();

const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com", // Use SMTP instead of 'service'
  port: 587,
  secure: false, // Use `true` for port 465, `false` for port 587
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

exports.sendEmail = async (to, subject, body, htmlBody = null, attachments = []) => {
  try {
    const mailOptions = {
      from: `"Muves - KK music application" <${process.env.EMAIL_USER}>`, // Sender's name
      to,
      subject,
      text: body, // Plain text fallback
      html: htmlBody || `<p>${body}</p>`, // Supports HTML
      attachments // { filename, content, cid, contentType }
    };

    const info = await transporter.sendMail(mailOptions);
    console.log(`✅ Email sent to ${to}: ${info.messageId}`);
    return true;
  } catch (error) {
    console.error(`❌ Error sending email to ${to}:`, error);
    return false;
  }
};
