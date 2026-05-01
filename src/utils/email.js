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
  const mailOptions = {
    from: `"Muves - KK music application" <${process.env.EMAIL_USER}>`,
    to,
    subject,
    text: body,
    html: htmlBody || `<p>${body}</p>`,
    attachments,
  };

  const info = await transporter.sendMail(mailOptions);
  console.log(`✅ Email sent to ${to}: ${info.messageId}`);
};
