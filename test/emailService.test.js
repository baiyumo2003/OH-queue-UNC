const test = require("node:test");
const assert = require("node:assert/strict");

const { buildQueueJoinMessage, getRecipients } = require("../src/emailService");

test("getRecipients prefers explicit queue notification recipients", () => {
  process.env.QUEUE_NOTIFICATION_RECIPIENTS = "teacher@unc.edu, ta@unc.edu";
  process.env.INSTRUCTOR_IDS = "fallback";

  assert.deepEqual(getRecipients(), ["teacher@unc.edu", "ta@unc.edu"]);

  delete process.env.QUEUE_NOTIFICATION_RECIPIENTS;
});

test("getRecipients falls back to instructor IDs and expands ONYENs", () => {
  delete process.env.QUEUE_NOTIFICATION_RECIPIENTS;
  delete process.env.INSTRUCTOR_NOTIFICATION_EMAILS;
  delete process.env.INSTRUCTOR_EMAILS;
  process.env.INSTRUCTOR_IDS = "teacher1, teacher2@unc.edu";

  assert.deepEqual(getRecipients(), ["teacher1@unc.edu", "teacher2@unc.edu"]);
});

test("getRecipients merges and deduplicates course TA recipients", () => {
  process.env.QUEUE_NOTIFICATION_RECIPIENTS = "teacher@unc.edu, ta1@unc.edu";
  process.env.INSTRUCTOR_IDS = "fallback";

  assert.deepEqual(getRecipients(["ta1@unc.edu", "ta2", "TA3@UNC.EDU"]), [
    "teacher@unc.edu",
    "ta1@unc.edu",
    "ta2@unc.edu",
    "ta3@unc.edu"
  ]);

  delete process.env.QUEUE_NOTIFICATION_RECIPIENTS;
});

test("buildQueueJoinMessage includes student and dashboard details", () => {
  const message = buildQueueJoinMessage({
    entry: {
      courseContext: "STOR 113",
      helpTopic: "Need help with R syntax",
      meetingLocation: "In person",
      studentEmail: "student@unc.edu",
      studentName: "Test Student"
    },
    instructorUrl: "https://example.com/instructor"
  });

  assert.match(message.subject, /Test Student/);
  assert.match(message.subject, /\[STOR 113\]/);
  assert.match(message.text, /STOR 113/);
  assert.match(message.text, /https:\/\/example\.com\/instructor/);
  assert.match(message.html, /Need help with R syntax/);
});

test("buildQueueJoinMessage renders rich help topic html with inline images", () => {
  const message = buildQueueJoinMessage({
    entry: {
      courseContext: "STOR 113",
      helpTopic: "See pasted image",
      helpTopicHtml: '<p><strong>See this</strong></p><img data-queue-image-index="0">',
      images: [
        {
          data: Buffer.from("fake image bytes"),
          filename: "question.jpg",
          mimeType: "image/jpeg"
        }
      ],
      meetingLocation: "In person",
      studentEmail: "student@unc.edu",
      studentName: "Test Student"
    },
    instructorUrl: "https://example.com/instructor"
  });

  assert.match(message.html, /<strong>See this<\/strong>/);
  assert.match(message.html, /src="data:image\/jpeg;base64,/);
  assert.match(message.html, /question\.jpg/);
});
