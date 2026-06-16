const nodemailer = require("nodemailer");
const { escapeHtml } = require("./utils");

let cachedTransporter = null;

function isEnabled() {
  return String(process.env.EMAIL_NOTIFICATIONS_ENABLED || "").toLowerCase() === "true";
}

function getRecipients() {
  const configured =
    process.env.QUEUE_NOTIFICATION_RECIPIENTS ||
    process.env.INSTRUCTOR_NOTIFICATION_EMAILS ||
    process.env.INSTRUCTOR_EMAILS ||
    "";

  const values = configured || process.env.INSTRUCTOR_IDS || "";
  return String(values)
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
    .map((value) => (value.includes("@") ? value : `${value}@unc.edu`));
}

function getTransporter() {
  if (cachedTransporter) {
    return cachedTransporter;
  }

  const host = String(process.env.SMTP_HOST || "").trim();
  if (!host) {
    throw new Error("SMTP_HOST is required when email notifications are enabled.");
  }

  const user = String(process.env.SMTP_USER || "").trim();
  const pass = String(process.env.SMTP_PASS || "");
  const port = Number(process.env.SMTP_PORT || 587);
  const secure = String(process.env.SMTP_SECURE || "").toLowerCase() === "true";
  const auth = user && pass ? { user, pass } : undefined;

  cachedTransporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth
  });

  return cachedTransporter;
}

function buildQueueJoinMessage({ entry, instructorUrl }) {
  const subject = `[Office Hours Queue] ${entry.studentName} joined the queue`;
  const text = [
    `${entry.studentName} joined the office hours queue.`,
    "",
    `Course: ${entry.courseContext}`,
    `Student: ${entry.studentName}`,
    `Email: ${entry.studentEmail}`,
    `Location: ${entry.meetingLocation}`,
    "",
    "Help topic:",
    entry.helpTopic,
    "",
    `Instructor dashboard: ${instructorUrl}`
  ].join("\n");

  const html = `
    <p><strong>${escapeHtml(entry.studentName)}</strong> joined the office hours queue.</p>
    <ul>
      <li><strong>Course:</strong> ${escapeHtml(entry.courseContext)}</li>
      <li><strong>Student:</strong> ${escapeHtml(entry.studentName)}</li>
      <li><strong>Email:</strong> ${escapeHtml(entry.studentEmail)}</li>
      <li><strong>Location:</strong> ${escapeHtml(entry.meetingLocation)}</li>
    </ul>
    <p><strong>Help topic:</strong></p>
    <p>${escapeHtml(entry.helpTopic)}</p>
    <p><a href="${escapeHtml(instructorUrl)}">Open instructor dashboard</a></p>
  `;

  return { html, subject, text };
}

async function sendQueueJoinNotification({ entry, instructorUrl }) {
  if (!isEnabled()) {
    return { skipped: true, reason: "disabled" };
  }

  const to = getRecipients();
  if (to.length === 0) {
    return { skipped: true, reason: "no recipients" };
  }

  const from = String(process.env.MAIL_FROM || process.env.SMTP_FROM || "").trim();
  if (!from) {
    throw new Error("MAIL_FROM is required when email notifications are enabled.");
  }

  const message = buildQueueJoinMessage({ entry, instructorUrl });
  const result = await getTransporter().sendMail({
    from,
    to,
    subject: message.subject,
    text: message.text,
    html: message.html
  });

  return { skipped: false, messageId: result.messageId };
}

module.exports = {
  buildQueueJoinMessage,
  getRecipients,
  sendQueueJoinNotification
};
