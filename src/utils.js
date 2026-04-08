function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatDuration(totalSeconds) {
  const seconds = Math.max(0, Math.floor(totalSeconds || 0));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  if (minutes > 0) {
    return `${minutes}m`;
  }

  return "<1m";
}

function normalizeUserId(value) {
  const input = String(value || "").trim().toLowerCase();
  if (!input) {
    return "";
  }

  return input.includes("@") ? input.split("@")[0] : input;
}

module.exports = {
  escapeHtml,
  formatDuration,
  normalizeUserId
};
