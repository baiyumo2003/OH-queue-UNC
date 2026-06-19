const DEFAULT_DIRECTORY_SEARCH_URL = "https://directory.unc.edu/api/search/{identifier}";
const DEFAULT_DIRECTORY_EMAIL_URL = "https://directory.unc.edu/api/search/?email={identifier}";

function pick(record, keys) {
  for (const key of keys) {
    const value = record?.[key];
    if (Array.isArray(value) && value.length > 0) {
      return String(value[0] || "").trim();
    }
    if (value) {
      return String(value).trim();
    }
  }
  return "";
}

function firstRecord(payload) {
  if (Array.isArray(payload)) {
    return payload[0] || null;
  }
  if (Array.isArray(payload?.results)) {
    return payload.results[0] || null;
  }
  if (Array.isArray(payload?.people)) {
    return payload.people[0] || null;
  }
  return payload?.user || payload?.person || payload || null;
}

function isEmail(value) {
  return String(value || "").includes("@");
}

function normalizeReverseDisplayName(value) {
  const [family, ...givenParts] = String(value || "").split(",");
  const given = givenParts.join(",").trim();
  const last = family.trim();
  return given && last ? `${given} ${last}` : String(value || "").trim();
}

function buildLookupUrl(identifier) {
  const configuredTemplate = String(process.env.DIRECTORY_LOOKUP_URL || "").trim();
  const template = configuredTemplate || (isEmail(identifier) ? DEFAULT_DIRECTORY_EMAIL_URL : DEFAULT_DIRECTORY_SEARCH_URL);
  return template.replaceAll("{identifier}", encodeURIComponent(identifier));
}

async function lookupDirectoryUser(identifier) {
  const normalizedIdentifier = String(identifier || "").trim().toLowerCase();
  if (!normalizedIdentifier || typeof fetch !== "function") {
    return null;
  }

  const url = buildLookupUrl(normalizedIdentifier);
  const headers = { Accept: "application/json" };
  const token = String(process.env.DIRECTORY_LOOKUP_TOKEN || "").trim();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(5000)
  });
  if (!response.ok) {
    return null;
  }

  const payload = await response.json();
  if (isEmail(normalizedIdentifier) && Array.isArray(payload) && payload.length !== 1) {
    return null;
  }

  const record = firstRecord(payload);
  if (!record) {
    return null;
  }

  const givenName = pick(record, ["givenName", "givenNameIterator", "given_name", "firstName", "first_name"]);
  const familyName = pick(record, ["sn", "snIterator", "surname", "lastName", "last_name"]);
  const reverseDisplayName = normalizeReverseDisplayName(pick(record, ["uncReverseDisplayName", "uncReverseDisplayNameIterator"]));
  const displayName =
    pick(record, ["displayName", "display_name", "name", "cn", "fullName", "full_name"]) ||
    reverseDisplayName ||
    `${givenName} ${familyName}`.trim();

  return {
    displayName,
    email: pick(record, ["mail", "mailIterator", "email", "emailAddress", "email_address"])
  };
}

module.exports = {
  lookupDirectoryUser
};
