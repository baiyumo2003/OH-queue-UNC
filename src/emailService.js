const nodemailer = require("nodemailer");
const { escapeHtml } = require("./utils");

let cachedTransporter = null;

function isEnabled() {
  return String(process.env.EMAIL_NOTIFICATIONS_ENABLED || "").toLowerCase() === "true";
}

function normalizeRecipient(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) {
    return "";
  }

  return normalized.includes("@") ? normalized : `${normalized}@unc.edu`;
}

function getRecipients(extraRecipients = []) {
  const configured =
    process.env.QUEUE_NOTIFICATION_RECIPIENTS ||
    process.env.INSTRUCTOR_NOTIFICATION_EMAILS ||
    process.env.INSTRUCTOR_EMAILS ||
    "";

  const values = configured || process.env.INSTRUCTOR_IDS || "";
  return Array.from(
    new Set(
      [
        ...String(values)
          .split(",")
          .map(normalizeRecipient),
        ...extraRecipients.map(normalizeRecipient)
      ].filter(Boolean)
    )
  );
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

function getEntryImages(entry) {
  if (Array.isArray(entry?.images)) {
    return entry.images;
  }

  if (typeof entry?.images === "string") {
    try {
      const parsed = JSON.parse(entry.images);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  return [];
}

function getImageBuffer(image) {
  if (Buffer.isBuffer(image?.data)) {
    return image.data;
  }

  if (Array.isArray(image?.data?.data)) {
    return Buffer.from(image.data.data);
  }

  return null;
}

function getEmailImageSrc({ entry, image, imageBaseUrl }) {
  const mimeType = String(image?.mimeType || image?.mime_type || "").trim().toLowerCase();
  if (/^image\/(?:png|jpe?g|gif|webp)$/.test(mimeType)) {
    const buffer = getImageBuffer(image);
    if (buffer) {
      return `data:${mimeType};base64,${buffer.toString("base64")}`;
    }
  }

  const entryId = entry?.id;
  const imageId = image?.id;
  if (entryId && imageId && imageBaseUrl) {
    const baseUrl = String(imageBaseUrl).replace(/\/+$/, "");
    return `${baseUrl}/instructor/entries/${encodeURIComponent(entryId)}/images/${encodeURIComponent(imageId)}`;
  }

  return "";
}

function renderEmailHelpTopic({ entry, imageBaseUrl }) {
  const images = getEntryImages(entry);
  const usedImageIndexes = new Set();
  const rawTopicHtml = String(entry.helpTopicHtml || entry.help_topic_html || "").trim();
  let topicHtml = rawTopicHtml || `<p>${escapeHtml(entry.helpTopic || entry.help_topic || "")}</p>`;

  topicHtml = topicHtml.replace(/<img data-queue-image-index="(\d+)">/g, (_match, indexValue) => {
    const index = Number(indexValue);
    const image = images[index];
    if (!image) {
      return "";
    }

    const src = getEmailImageSrc({ entry, image, imageBaseUrl });
    if (!src) {
      return "";
    }

    usedImageIndexes.add(index);
    const filename = String(image.filename || "").trim();
    const label = filename ? `Image ${index + 1}: ${filename}` : `Image ${index + 1}`;
    return `<img src="${escapeHtml(src)}" alt="${escapeHtml(label)}" style="display:block;max-width:100%;width:auto;max-height:480px;margin:12px 0;border:1px solid #d9e2ec;border-radius:10px;object-fit:contain;">`;
  });

  const imagePreviews = images
    .map((image, index) => ({ image, index }))
    .filter(({ index }) => !usedImageIndexes.has(index))
    .map(({ image, index }) => {
      const src = getEmailImageSrc({ entry, image, imageBaseUrl });
      if (!src) {
        return "";
      }

      const filename = String(image.filename || "").trim();
      const label = filename ? `Image ${index + 1}: ${filename}` : `Image ${index + 1}`;
      return `
        <figure style="margin:12px 0;">
          <img src="${escapeHtml(src)}" alt="${escapeHtml(label)}" style="display:block;max-width:100%;width:auto;max-height:480px;border:1px solid #d9e2ec;border-radius:10px;object-fit:contain;">
          <figcaption style="color:#526173;font-size:13px;margin-top:6px;">${escapeHtml(label)}</figcaption>
        </figure>
      `;
    })
    .filter(Boolean)
    .join("");

  return `
    <div style="font-size:16px;line-height:1.55;color:#1f2937;">
      ${topicHtml}
      ${imagePreviews}
    </div>
  `;
}

function getUrlOrigin(value) {
  try {
    return new URL(value).origin;
  } catch {
    return "";
  }
}

function buildQueueJoinMessage({ entry, instructorUrl, imageBaseUrl = "" }) {
  const courseContext = String(entry.courseContext || "Course").trim();
  const imageCount = Number(entry.imageCount || getEntryImages(entry).length || 0);
  const imageLine = imageCount > 0 ? `Images: ${imageCount} attached` : "";
  const subject = `[Office Hours Queue][${courseContext}] ${entry.studentName} joined the queue`;
  const helpTopicHtml = renderEmailHelpTopic({ entry, imageBaseUrl });
  const text = [
    `${entry.studentName} joined the office hours queue.`,
    "",
    `Course: ${courseContext}`,
    `Student: ${entry.studentName}`,
    `Email: ${entry.studentEmail}`,
    `Location: ${entry.meetingLocation}`,
    ...(imageLine ? [imageLine] : []),
    "",
    "Help topic:",
    entry.helpTopic,
    "",
    `Staff dashboard: ${instructorUrl}`
  ].join("\n");

  const html = `
    <p><strong>${escapeHtml(entry.studentName)}</strong> joined the office hours queue.</p>
    <ul>
      <li><strong>Course:</strong> ${escapeHtml(courseContext)}</li>
      <li><strong>Student:</strong> ${escapeHtml(entry.studentName)}</li>
      <li><strong>Email:</strong> ${escapeHtml(entry.studentEmail)}</li>
      <li><strong>Location:</strong> ${escapeHtml(entry.meetingLocation)}</li>
      ${imageCount > 0 ? `<li><strong>Images:</strong> ${imageCount} attached</li>` : ""}
    </ul>
    <p><strong>Help topic:</strong></p>
    ${helpTopicHtml}
    <p><a href="${escapeHtml(instructorUrl)}">Open staff dashboard</a></p>
  `;

  return { html, subject, text };
}

async function sendQueueJoinNotification({ entry, instructorUrl, extraRecipients = [] }) {
  if (!isEnabled()) {
    return { skipped: true, reason: "disabled" };
  }

  const to = getRecipients(extraRecipients);
  if (to.length === 0) {
    return { skipped: true, reason: "no recipients" };
  }

  const from = String(process.env.MAIL_FROM || process.env.SMTP_FROM || "").trim();
  if (!from) {
    throw new Error("MAIL_FROM is required when email notifications are enabled.");
  }

  const message = buildQueueJoinMessage({ entry, instructorUrl, imageBaseUrl: getUrlOrigin(instructorUrl) });
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
