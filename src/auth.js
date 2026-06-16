const { normalizeUserId } = require("./utils");

const DEV_AUTH_COOKIE = "dev_auth";
const ROLE_OVERRIDE_COOKIE = "role_override";

function parseCookies(cookieHeader) {
  const cookies = {};
  for (const part of String(cookieHeader || "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (!key) {
      continue;
    }
    cookies[key] = decodeURIComponent(rest.join("=") || "");
  }
  return cookies;
}

function getFirstConfiguredValue(rawValue) {
  return String(rawValue || "")
    .split(",")[0]
    .trim();
}

function readHeader(req, key) {
  const directValue = req.headers?.[key];
  if (directValue) {
    return Array.isArray(directValue) ? directValue[0] : directValue;
  }

  const normalizedKey = key.toLowerCase();
  return req.headers?.[normalizedKey];
}

function getForwardedUser(req) {
  const candidates = [
    // UNC CloudApps Shibboleth documentation calls out HTTP_UID explicitly.
    "http_uid",
    "http-uid",
    "uid",
    "x-remote-user",
    "remote-user",
    "remote_user",
    "x-forwarded-user",
    "x-auth-request-user",
    "x-remote-email",
    "preferred_username",
    "mail",
    "eppn"
  ];

  for (const key of candidates) {
    const value = readHeader(req, key);
    if (value) {
      return String(value).trim();
    }
  }

  return "";
}

function getForwardedName(req) {
  const candidates = [
    "http_displayname",
    "http-displayname",
    "http_display_name",
    "http-display-name",
    "displayname",
    "display_name",
    "display-name",
    "http_preferredname",
    "http-preferredname",
    "http_preferred_name",
    "http-preferred-name",
    "preferredname",
    "preferred_name",
    "preferred-name",
    "http_name",
    "http-name",
    "name",
    "x-display-name",
    "http_cn",
    "http-cn",
    "cn"
  ];

  for (const key of candidates) {
    const value = readHeader(req, key);
    if (value) {
      return String(value).trim();
    }
  }

  const given =
    readHeader(req, "http_givenname") ||
    readHeader(req, "http-givenname") ||
    readHeader(req, "http_given_name") ||
    readHeader(req, "http-given-name") ||
    readHeader(req, "givenname") ||
    readHeader(req, "given_name") ||
    readHeader(req, "given-name");
  const family = readHeader(req, "http_sn") || readHeader(req, "http-sn") || readHeader(req, "sn");
  const fallback = `${given || ""} ${family || ""}`.trim();
  return fallback;
}

function getForwardedEmail(req, fallbackUser) {
  const candidates = [
    "http_mail",
    "http-mail",
    "mail",
    "x-forwarded-email",
    "x-remote-email",
    "http_eppn",
    "http-eppn",
    "eppn"
  ];
  for (const key of candidates) {
    const value = readHeader(req, key);
    if (value) {
      return String(value).trim().toLowerCase();
    }
  }

  if (fallbackUser.includes("@")) {
    return fallbackUser.toLowerCase();
  }

  if (fallbackUser) {
    return `${normalizeUserId(fallbackUser)}@unc.edu`;
  }

  return "";
}

function decodeDevCookie(req) {
  const cookies = parseCookies(req.headers?.cookie);
  const raw = cookies[DEV_AUTH_COOKIE];
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

function getInstructorIds() {
  return new Set(
    String(process.env.INSTRUCTOR_IDS || "")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean)
  );
}

function getRoleSwitchUsers() {
  return new Set(
    String(process.env.ROLE_SWITCH_USERS || "")
      .split(",")
      .map((value) => normalizeUserId(value))
      .filter(Boolean)
  );
}

function canSwitchRolesForIdentity(userId, email) {
  const allowed = getRoleSwitchUsers();
  return allowed.has(normalizeUserId(userId)) || allowed.has(normalizeUserId(email));
}

function getRequestedRoleOverride(req) {
  const cookies = parseCookies(req.headers?.cookie);
  const role = String(cookies[ROLE_OVERRIDE_COOKIE] || "").trim().toLowerCase();
  return role === "student" || role === "instructor" ? role : "";
}

function getExternalBaseUrl(req) {
  const configured = getFirstConfiguredValue(process.env.APP_BASE_URL);
  if (configured) {
    return configured.replace(/\/$/, "");
  }

  const protocol = getFirstConfiguredValue(req.headers["x-forwarded-proto"]) || req.protocol || "http";
  const host =
    getFirstConfiguredValue(req.headers["x-forwarded-host"]) ||
    getFirstConfiguredValue(req.headers.host) ||
    `localhost:${process.env.PORT || 3000}`;
  return `${protocol}://${host}`;
}

function getLoginUrl(req) {
  const configured = getFirstConfiguredValue(process.env.SSO_LOGIN_URL);
  if (configured) {
    return configured;
  }

  const target = encodeURIComponent(`${getExternalBaseUrl(req)}/`);
  return `${getExternalBaseUrl(req)}/Shibboleth.sso/Login?target=${target}`;
}

function getLogoutUrl(req) {
  const configured = getFirstConfiguredValue(process.env.SSO_LOGOUT_URL);
  if (configured) {
    return configured;
  }

  const target = encodeURIComponent(`${getExternalBaseUrl(req)}/`);
  return `${getExternalBaseUrl(req)}/Shibboleth.sso/Logout?return=${target}`;
}

function resolveUser(req) {
  const trustProxyAuth = String(process.env.TRUST_PROXY_AUTH || "").toLowerCase() === "true";
  const allowDevAuth = String(process.env.ALLOW_DEV_AUTH || "").toLowerCase() === "true";
  const instructorIds = getInstructorIds();

  let user = null;

  if (trustProxyAuth) {
    const forwardedUser = getForwardedUser(req);
    if (forwardedUser) {
      const userId = normalizeUserId(forwardedUser);
      const email = getForwardedEmail(req, forwardedUser);
      user = {
        authSource: "sso",
        userId,
        displayName: getForwardedName(req) || userId,
        email,
        role: instructorIds.has(userId) || instructorIds.has(email) ? "instructor" : "student"
      };
    }
  }

  if (!user && allowDevAuth) {
    const devUser = decodeDevCookie(req);
    if (devUser?.userId) {
      const userId = normalizeUserId(devUser.userId);
      const email = String(devUser.email || `${userId}@local.dev`).trim().toLowerCase();
      user = {
        authSource: "dev",
        userId,
        displayName: String(devUser.displayName || userId),
        email,
        role: devUser.role === "instructor" ? "instructor" : "student"
      };
    }
  }

  if (user) {
    const canSwitchRoles = canSwitchRolesForIdentity(user.userId, user.email);
    const requestedRole = canSwitchRoles ? getRequestedRoleOverride(req) : "";
    user.canSwitchRoles = canSwitchRoles;
    user.baseRole = user.role;
    user.roleOverride = requestedRole || "";
    if (requestedRole) {
      user.role = requestedRole;
    }
  }

  return user;
}

function attachUser(req, _res, next) {
  req.user = resolveUser(req);
  req.loginUrl = getLoginUrl(req);
  req.logoutUrl = getLogoutUrl(req);
  next();
}

function requireAuth(req, res, next) {
  if (!req.user) {
    return res.redirect(`/?error=${encodeURIComponent("Please sign in with UNC SSO before joining the queue.")}`);
  }
  next();
}

function requireInstructor(req, res, next) {
  if (!req.user) {
    return res.redirect(`/?error=${encodeURIComponent("Please sign in first.")}`);
  }

  if (req.user.role !== "instructor") {
    return res.status(403).send("Instructor access required.");
  }

  next();
}

function serializeDevCookie(payload) {
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${DEV_AUTH_COOKIE}=${encoded}; Path=/; HttpOnly; SameSite=Lax`;
}

function clearDevCookie() {
  return `${DEV_AUTH_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`;
}

function serializeRoleOverride(role) {
  return `${ROLE_OVERRIDE_COOKIE}=${encodeURIComponent(role)}; Path=/; HttpOnly; SameSite=Lax`;
}

function clearRoleOverrideCookie() {
  return `${ROLE_OVERRIDE_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`;
}

module.exports = {
  attachUser,
  clearDevCookie,
  clearRoleOverrideCookie,
  canSwitchRolesForIdentity,
  getExternalBaseUrl,
  getFirstConfiguredValue,
  getLoginUrl,
  getLogoutUrl,
  parseCookies,
  requireAuth,
  requireInstructor,
  resolveUser,
  serializeDevCookie,
  serializeRoleOverride
};
