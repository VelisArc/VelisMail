const DB_SCHEMES = [
  "postgresql://",
  "postgres://",
  "mysql://",
  "mysql2://",
  "mariadb://",
  "sqlite://",
  "mongodb://",
  "mongodb+srv://",
  "redis://",
  "rediss://",
  "libsql://",
  "sqlserver://",
  "mssql://",
  "clickhouse://",
  "custom://",
];

const textEncoder = new TextEncoder();
const FREE_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "icloud.com",
  "me.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
]);
const PERSONAL_MAIL_DOMAIN = "velismail.online";

function resolveCorsOrigin(request, env) {
  const configured = (env.FRONTEND_ORIGIN || "*")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (configured.length === 0 || configured.includes("*")) {
    return "*";
  }

  const requestOrigin = request.headers.get("Origin");
  if (requestOrigin && configured.includes(requestOrigin)) {
    return requestOrigin;
  }

  return configured[0];
}

function corsHeaders(request, env) {
  return {
    "Access-Control-Allow-Origin": resolveCorsOrigin(request, env),
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS, PATCH",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With",
    "Access-Control-Max-Age": "86400",
  };
}

function jsonResponse(request, env, body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status || 200,
    headers: {
      "content-type": "application/json;charset=UTF-8",
      ...corsHeaders(request, env),
      ...(init.headers || {}),
    },
  });
}

function validationError(request, env, message, errorType = "ValidationError", status = 400) {
  return jsonResponse(
    request,
    env,
    {
      success: false,
      errorType,
      message,
    },
    { status },
  );
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function isValidEmail(value) {
  return typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isValidDatabaseUrl(value) {
  if (typeof value !== "string") {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  return DB_SCHEMES.some((scheme) => normalized.startsWith(scheme));
}

function isValidHttpUrl(value) {
  if (typeof value !== "string" || !value.trim()) {
    return false;
  }

  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function isValidDomain(value) {
  return (
    typeof value === "string" &&
    /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i.test(value.trim())
  );
}

function issueAccessToken(email) {
  const normalized = String(email || "guest").toLowerCase();
  const safeEmail = normalized.replace(/[^a-z0-9]/g, "").slice(0, 18) || "guest";
  return `vm_${safeEmail}_${crypto.randomUUID().replace(/-/g, "")}`;
}

function buildDiagnosticStep(label, target) {
  return {
    label,
    target,
    status: "verified",
    checkedAt: new Date().toISOString(),
  };
}

function randomOtp() {
  const randomBytes = new Uint32Array(1);
  crypto.getRandomValues(randomBytes);
  return String((randomBytes[0] % 900000) + 100000);
}

function maskEmail(email) {
  const [localPart, domain] = String(email).split("@");
  if (!localPart || !domain) {
    return email;
  }

  if (localPart.length <= 2) {
    return `${localPart[0] || "*"}*@${domain}`;
  }

  return `${localPart.slice(0, 2)}${"*".repeat(Math.max(1, localPart.length - 2))}@${domain}`;
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function extractDomainFromEmail(email) {
  const normalized = normalizeEmail(email);
  return normalized.includes("@") ? normalized.split("@")[1] : "";
}

function parseCommaSeparatedList(value) {
  return String(value || "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

function buildCompanyEmail(env, localPartEnvName, fallbackLocalPart = "noreply") {
  const explicitEmail = env[localPartEnvName];
  if (explicitEmail && explicitEmail.includes("@")) {
    return normalizeEmail(explicitEmail);
  }

  const domain = String(env.PRIMARY_MAIL_DOMAIN || "").trim().toLowerCase();
  if (!domain) {
    return "";
  }

  const localPart = String(env[`${localPartEnvName}_LOCAL_PART`] || fallbackLocalPart).trim().toLowerCase();
  return `${localPart}@${domain}`;
}

function getAllowedSenderDomains(env) {
  const configured = parseCommaSeparatedList(env.ALLOWED_SENDER_DOMAINS);
  const primaryDomain = String(env.PRIMARY_MAIL_DOMAIN || "").trim().toLowerCase();
  if (primaryDomain && !configured.includes(primaryDomain)) {
    configured.push(primaryDomain);
  }
  return configured;
}

function validateCompanySender(email) {
  const normalized = normalizeEmail(email);
  const domain = extractDomainFromEmail(normalized);
  if (!normalized || !domain) {
    return "Sender email is missing.";
  }

  if (FREE_EMAIL_DOMAINS.has(domain)) {
    return "Sender email must use your company domain, not a free mailbox like Gmail.";
  }

  return null;
}

function resolveDefaultSender(env, mode = "mail") {
  if (mode === "otp") {
    return {
      email: buildCompanyEmail(env, "OTP_FROM_EMAIL", "verify"),
      name: env.BREVO_SENDER_NAME || env.MAIL_FROM_NAME || "VelisMail",
    };
  }

  return {
    email: buildCompanyEmail(env, "MAIL_FROM_EMAIL", "noreply") || buildCompanyEmail(env, "OTP_FROM_EMAIL", "verify"),
    name: env.MAIL_FROM_NAME || env.BREVO_SENDER_NAME || "VelisMail",
  };
}

function resolveRequestedSender(env, requestedEmail, requestedName) {
  const defaultSender = resolveDefaultSender(env, "mail");
  const allowedDomains = getAllowedSenderDomains(env);
  const normalizedRequested = normalizeEmail(requestedEmail);
  const requestedDomain = extractDomainFromEmail(normalizedRequested);

  if (!normalizedRequested) {
    return defaultSender;
  }

  if (!allowedDomains.includes(requestedDomain)) {
    return {
      error: `Sender domain ${requestedDomain || "unknown"} is not allowed. Verify your company domain in Brevo and add it to ALLOWED_SENDER_DOMAINS.`,
    };
  }

  return {
    email: normalizedRequested,
    name: requestedName || defaultSender.name,
  };
}

function bytesToBase64Url(bytes) {
  let binary = "";
  const value = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (const byte of value) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  const binary = atob(normalized + padding);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function base64UrlJson(value) {
  return bytesToBase64Url(textEncoder.encode(JSON.stringify(value)));
}

async function importHmacKey(secret) {
  return crypto.subtle.importKey(
    "raw",
    textEncoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

async function signToken(payload, secret) {
  const header = base64UrlJson({ alg: "HS256", typ: "JWT" });
  const body = base64UrlJson(payload);
  const unsignedToken = `${header}.${body}`;
  const key = await importHmacKey(secret);
  const signature = await crypto.subtle.sign("HMAC", key, textEncoder.encode(unsignedToken));
  return `${unsignedToken}.${bytesToBase64Url(signature)}`;
}

async function verifyToken(token, secret) {
  if (typeof token !== "string") {
    return null;
  }

  const segments = token.split(".");
  if (segments.length !== 3) {
    return null;
  }

  const [header, body, signature] = segments;
  const key = await importHmacKey(secret);
  const isValid = await crypto.subtle.verify(
    "HMAC",
    key,
    base64UrlToBytes(signature),
    textEncoder.encode(`${header}.${body}`),
  );

  if (!isValid) {
    return null;
  }

  try {
    return JSON.parse(new TextDecoder().decode(base64UrlToBytes(body)));
  } catch {
    return null;
  }
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", textEncoder.encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function hashOtp(env, email, otp, salt, purpose) {
  const normalizedEmail = String(email).trim().toLowerCase();
  return sha256Hex(`${env.OTP_SIGNING_SECRET}:${purpose}:${normalizedEmail}:${otp}:${salt}`);
}

function looksLikeBrevoSmtpSecret(value) {
  return typeof value === "string" && /^xsmtpsib-/i.test(value.trim());
}

function normalizeDnsAnswer(value) {
  return String(value || "")
    .trim()
    .replace(/\.$/, "")
    .replace(/^"(.*)"$/, "$1")
    .replace(/"\s*"/g, "")
    .trim();
}

async function queryDnsAnswers(name, type) {
  const response = await fetch(
    `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${encodeURIComponent(type)}`,
    {
      headers: {
        accept: "application/dns-json",
      },
    },
  );

  if (!response.ok) {
    throw new Error(`DNS lookup failed for ${name} (${type}).`);
  }

  const data = await response.json();
  if (!Array.isArray(data.Answer)) {
    return [];
  }

  return data.Answer.map((answer) => normalizeDnsAnswer(answer.data));
}

async function buildDomainChecks(domain, verificationToken) {
  const txtHost = `_velismail-verify.${domain}`;
  const dkimHost = `velismail._domainkey.${domain}`;
  const dmarcHost = `_dmarc.${domain}`;
  const expectedMxHosts = ["mx1.velismail.online", "mx2.velismail.online"];
  const expectedSpf = "include:velismail.online";
  const expectedDkimTarget = "dkim.velismail.online";

  const [txtAnswers, mxAnswers, domainTxtAnswers, dkimAnswers, dmarcAnswers] = await Promise.all([
    queryDnsAnswers(txtHost, "TXT"),
    queryDnsAnswers(domain, "MX"),
    queryDnsAnswers(domain, "TXT"),
    queryDnsAnswers(dkimHost, "CNAME"),
    queryDnsAnswers(dmarcHost, "TXT"),
  ]);

  const normalizedMxHosts = mxAnswers
    .map((answer) => normalizeDnsAnswer(answer.split(/\s+/).pop()))
    .filter(Boolean);
  const normalizedDomainTxt = domainTxtAnswers.map(normalizeDnsAnswer);
  const normalizedDkimAnswers = dkimAnswers.map(normalizeDnsAnswer);
  const normalizedDmarcAnswers = dmarcAnswers.map(normalizeDnsAnswer);
  const normalizedTxtAnswers = txtAnswers.map(normalizeDnsAnswer);

  const txtActual = normalizedTxtAnswers.join(", ") || "TXT record not found";
  const mxActual = normalizedMxHosts.join(", ") || "MX records not found";
  const spfActual = normalizedDomainTxt.find((value) => /^v=spf1/i.test(value)) || "SPF record not found";
  const dkimActual = normalizedDkimAnswers.join(", ") || "DKIM CNAME not found";
  const dmarcActual = normalizedDmarcAnswers.find((value) => /^v=dmarc1/i.test(value)) || "DMARC record not found";

  return [
    {
      key: "txt",
      label: "Ownership TXT",
      expected: verificationToken,
      actual: txtActual,
      status: verificationToken && normalizedTxtAnswers.some((value) => value.includes(verificationToken)) ? "verified" : "failed",
    },
    {
      key: "mx",
      label: "Inbound MX",
      expected: expectedMxHosts.join(" / "),
      actual: mxActual,
      status: expectedMxHosts.every((host) => normalizedMxHosts.includes(host)) ? "verified" : "failed",
    },
    {
      key: "spf",
      label: "SPF",
      expected: `v=spf1 ${expectedSpf} ~all`,
      actual: spfActual,
      status: normalizedDomainTxt.some((value) => value.includes(expectedSpf)) ? "verified" : "failed",
    },
    {
      key: "dkim",
      label: "DKIM",
      expected: expectedDkimTarget,
      actual: dkimActual,
      status: normalizedDkimAnswers.some((value) => value === expectedDkimTarget) ? "verified" : "failed",
    },
    {
      key: "dmarc",
      label: "DMARC",
      expected: "v=DMARC1",
      actual: dmarcActual,
      status: normalizedDmarcAnswers.some((value) => /^v=dmarc1/i.test(value)) ? "verified" : "failed",
    },
  ];
}

async function sendBrevoEmail(env, options) {
  const apiKey = env.BREVO_API_KEY;
  const senderEmail = options.sender?.email;
  const senderName = options.sender?.name;

  if (!apiKey) {
    throw new Error("BREVO_API_KEY is missing.");
  }

  if (looksLikeBrevoSmtpSecret(apiKey)) {
    throw new Error("BREVO_API_KEY must be a Brevo HTTP API key (xkeysib-...), not an SMTP secret (xsmtpsib-...).");
  }

  const senderError = validateCompanySender(senderEmail);
  if (senderError) {
    throw new Error(senderError);
  }

  const response = await fetch(env.BREVO_API_URL || "https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "api-key": apiKey,
    },
    body: JSON.stringify({
      sender: {
        email: senderEmail,
        name: senderName,
      },
      to: options.to,
      subject: options.subject,
      htmlContent: options.htmlContent,
      textContent: options.textContent,
      replyTo: options.replyTo || {
        email: senderEmail,
        name: senderName,
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Brevo API error ${response.status}: ${errorText}`);
  }

  return response.json().catch(() => ({}));
}

function buildOtpEmail(displayName, otp, ttlMinutes) {
  const safeName = displayName || "there";
  const subject = "Your VelisMail verification code";
  const textContent = [
    `Hello ${safeName},`,
    "",
    `Your VelisMail verification code is ${otp}.`,
    `This code expires in ${ttlMinutes} minute${ttlMinutes === 1 ? "" : "s"}.`,
    "",
    "If you did not request this code, you can ignore this email.",
    "",
    "VelisMail Security",
  ].join("\n");

  const htmlContent = `
    <div style="font-family:Arial,sans-serif;background:#f6f3ed;padding:32px;color:#2d1c10">
      <div style="max-width:560px;margin:0 auto;background:#fffaf2;border-radius:18px;padding:32px;border:1px solid #eadfce">
        <p style="margin:0 0 12px;font-size:16px;">Hello ${safeName},</p>
        <h1 style="margin:0 0 16px;font-size:28px;line-height:1.2;">Verify your email</h1>
        <p style="margin:0 0 20px;font-size:15px;line-height:1.6;">
          Use this one-time code to finish your VelisMail signup.
        </p>
        <div style="font-size:36px;letter-spacing:10px;font-weight:700;text-align:center;padding:18px 16px;background:#f5ead7;border-radius:14px;color:#8c5617;">
          ${otp}
        </div>
        <p style="margin:20px 0 0;font-size:14px;line-height:1.6;color:#5c4a3b;">
          This code expires in ${ttlMinutes} minute${ttlMinutes === 1 ? "" : "s"}.
          If you did not request it, you can safely ignore this email.
        </p>
      </div>
    </div>
  `;

  return { subject, textContent, htmlContent };
}

async function handleRegister(request, env) {
  const body = await readJson(request);
  if (!body) {
    return validationError(request, env, "Request body must be valid JSON.");
  }

  if (!isValidEmail(body.email)) {
    return validationError(request, env, "A valid email address is required.");
  }

  if (body.accountType === "personal" && extractDomainFromEmail(body.email) !== PERSONAL_MAIL_DOMAIN) {
    return validationError(request, env, `Personal accounts must use @${PERSONAL_MAIL_DOMAIN}.`);
  }

  if (body.accountType === "business") {
    if (!isValidEmail(body.recoveryEmail || "")) {
      return validationError(request, env, "Business signup requires a valid recovery email.");
    }
    if (body.customDomain && !isValidDomain(body.customDomain)) {
      return validationError(request, env, "Business signup requires a valid custom domain.");
    }
  }

  if (typeof body.password !== "string" || body.password.length < 6) {
    return validationError(request, env, "Password must be at least 6 characters long.");
  }

  if (typeof body.displayName !== "string" || body.displayName.trim().length < 2) {
    return validationError(request, env, "Display name must be at least 2 characters long.");
  }

  return jsonResponse(request, env, {
    success: true,
    message: "Registration accepted by Cloudflare Worker.",
    user: {
      id: `usr_${crypto.randomUUID().slice(0, 8)}`,
      email: body.email,
      displayName: body.displayName.trim(),
      accountType: body.accountType || "personal",
    },
  });
}

async function handleLogin(request, env) {
  const body = await readJson(request);
  if (!body) {
    return validationError(request, env, "Request body must be valid JSON.");
  }

  if (!isValidEmail(body.email)) {
    return validationError(request, env, "A valid email address is required.");
  }

  return jsonResponse(request, env, {
    success: true,
    access_token: issueAccessToken(body.email),
    token_type: "Bearer",
    expires_in: 3600,
    user: {
      email: body.email,
    },
  });
}

async function handleSendOtp(request, env) {
  const body = await readJson(request);
  if (!body) {
    return validationError(request, env, "Request body must be valid JSON.");
  }

  if (!isValidEmail(body.email)) {
    return validationError(request, env, "A valid email address is required.");
  }

  if (!env.OTP_SIGNING_SECRET) {
    return validationError(
      request,
      env,
      "OTP_SIGNING_SECRET is missing in the Worker environment.",
      "ConfigurationError",
      503,
    );
  }

  if (!env.BREVO_API_KEY) {
    return validationError(
      request,
      env,
      "BREVO_API_KEY is missing in the Worker environment. Cloudflare Workers must use Brevo's HTTP API key for real OTP delivery.",
      "ConfigurationError",
      503,
    );
  }

  if (looksLikeBrevoSmtpSecret(env.BREVO_API_KEY)) {
    return validationError(
      request,
      env,
      "BREVO_API_KEY is using an SMTP secret. Replace it with your Brevo HTTP API key (xkeysib-...) for real OTP delivery.",
      "ConfigurationError",
      503,
    );
  }

  const otpSender = resolveDefaultSender(env, "otp");
  const otpSenderError = validateCompanySender(otpSender.email);
  if (otpSenderError) {
    return validationError(request, env, otpSenderError, "ConfigurationError", 503);
  }

  const purpose = typeof body.purpose === "string" ? body.purpose : "register";
  const otp = randomOtp();
  const ttlSeconds = Number(env.OTP_TTL_SECONDS || 600);
  const expiresAt = Date.now() + ttlSeconds * 1000;
  const salt = crypto.randomUUID();
  const otpHash = await hashOtp(env, body.email, otp, salt, purpose);
  const challengeToken = await signToken(
    {
      sub: String(body.email).trim().toLowerCase(),
      purpose,
      salt,
      otpHash,
      iat: Date.now(),
      exp: expiresAt,
    },
    env.OTP_SIGNING_SECRET,
  );

  const message = buildOtpEmail(body.displayName, otp, Math.max(1, Math.round(ttlSeconds / 60)));
  const delivery = await sendBrevoEmail(env, {
    sender: otpSender,
    to: [
      {
        email: normalizeEmail(body.email),
        name: body.displayName || undefined,
      },
    ],
    subject: message.subject,
    htmlContent: message.htmlContent,
    textContent: message.textContent,
  });

  return jsonResponse(request, env, {
    success: true,
    challengeToken,
    expiresIn: ttlSeconds,
    maskedEmail: maskEmail(body.email),
    provider: "brevo",
    messageId: delivery.messageId || null,
  });
}

async function handleVerifyOtp(request, env) {
  const body = await readJson(request);
  if (!body) {
    return validationError(request, env, "Request body must be valid JSON.");
  }

  if (!env.OTP_SIGNING_SECRET) {
    return validationError(
      request,
      env,
      "OTP_SIGNING_SECRET is missing in the Worker environment.",
      "ConfigurationError",
      503,
    );
  }

  if (!isValidEmail(body.email)) {
    return validationError(request, env, "A valid email address is required.");
  }

  if (typeof body.otp !== "string" || !/^\d{6}$/.test(body.otp.trim())) {
    return validationError(request, env, "Enter a valid 6-digit verification code.");
  }

  if (typeof body.challengeToken !== "string" || !body.challengeToken) {
    return validationError(request, env, "challengeToken is required.");
  }

  const payload = await verifyToken(body.challengeToken, env.OTP_SIGNING_SECRET);
  if (!payload) {
    return validationError(request, env, "The verification session is invalid or has been tampered with.", "OtpInvalid", 401);
  }

  if (Date.now() > Number(payload.exp || 0)) {
    return validationError(request, env, "This verification code has expired. Request a new one.", "OtpExpired", 401);
  }

  const normalizedEmail = String(body.email).trim().toLowerCase();
  const purpose = typeof body.purpose === "string" ? body.purpose : "register";
  if (payload.sub !== normalizedEmail || payload.purpose !== purpose) {
    return validationError(request, env, "This verification code does not match the current request.", "OtpMismatch", 401);
  }

  const expectedHash = await hashOtp(env, normalizedEmail, body.otp.trim(), payload.salt, purpose);
  if (expectedHash !== payload.otpHash) {
    return validationError(request, env, "Invalid verification code.", "OtpInvalid", 401);
  }

  const verificationToken = await signToken(
    {
      sub: normalizedEmail,
      purpose,
      verifiedAt: Date.now(),
      exp: Date.now() + 15 * 60 * 1000,
    },
    env.OTP_SIGNING_SECRET,
  );

  return jsonResponse(request, env, {
    success: true,
    verificationToken,
    expiresIn: 15 * 60,
  });
}

async function handleVerifyInfrastructure(request, env) {
  const body = await readJson(request);
  if (!body) {
    return validationError(request, env, "Request body must be valid JSON.");
  }

  if (!isValidDatabaseUrl(body.dbUrl)) {
    return validationError(
      request,
      env,
      "Invalid Database Connection schema. Expected protocol://user:pass@host/db",
    );
  }

  if (typeof body.apiKey !== "string" || body.apiKey.trim().length < 8) {
    return validationError(request, env, "Invalid Secret API Key format length.");
  }

  if (body.apiProvider === "custom_webhook" && !isValidHttpUrl(body.apiEndpoint)) {
    return validationError(request, env, "Custom mail providers require a valid delivery endpoint URL.");
  }

  return jsonResponse(request, env, {
    success: true,
    deployment: "cloudflare-worker",
    checks: [
      buildDiagnosticStep("Database URL accepted", body.dbUrl),
      buildDiagnosticStep("API key format accepted", body.apiProvider || "mail-provider"),
      buildDiagnosticStep("Edge verification finished", "workers"),
    ],
  });
}

async function handleVerifyDomain(request, env) {
  const body = await readJson(request);
  if (!body) {
    return validationError(request, env, "Request body must be valid JSON.");
  }

  const domain = String(body.domain || "").trim().toLowerCase();
  if (!isValidDomain(domain)) {
    return validationError(request, env, "Enter a valid business domain before starting verification.");
  }

  if (!isValidDatabaseUrl(body.dbUrl)) {
    return validationError(
      request,
      env,
      "Database connectivity check failed because the connection string is invalid.",
    );
  }

  if (typeof body.apiKey !== "string" || body.apiKey.trim().length < 8) {
    return validationError(request, env, "Provider API key is missing or too short.");
  }

  if (body.provider === "custom_webhook" && !isValidHttpUrl(body.providerEndpoint)) {
    return validationError(request, env, "Custom provider endpoint must be a valid http or https URL.");
  }

  if (typeof body.verificationToken !== "string" || !body.verificationToken.trim()) {
    return validationError(request, env, "verificationToken is required to validate your ownership TXT record.");
  }

  let checks;
  try {
    checks = await buildDomainChecks(domain, body.verificationToken.trim());
  } catch (error) {
    return validationError(
      request,
      env,
      error instanceof Error ? error.message : "DNS verification lookup failed.",
      "DnsLookupError",
      502,
    );
  }

  const failedChecks = checks.filter((check) => check.status !== "verified");

  return jsonResponse(request, env, {
    success: failedChecks.length === 0,
    domain,
    workerMode: true,
    message: failedChecks.length === 0
      ? "Domain verification completed successfully."
      : `DNS verification is incomplete. Fix: ${failedChecks.map((check) => check.label).join(", ")}.`,
    checks,
  });
}

async function handleSendMail(request, env) {
  const body = await readJson(request);
  if (!body) {
    return validationError(request, env, "Request body must be valid JSON.");
  }

  if (!Array.isArray(body.to) || body.to.length === 0 || body.to.some((item) => !isValidEmail(item))) {
    return validationError(request, env, "At least one valid recipient email is required.");
  }

  if (typeof body.subject !== "string" || !body.subject.trim()) {
    return validationError(request, env, "Subject is required.");
  }

  if (typeof body.body !== "string" || !body.body.trim()) {
    return validationError(request, env, "Body is required.");
  }

  if (!env.BREVO_API_KEY) {
    return validationError(
      request,
      env,
      "BREVO_API_KEY is missing in the Worker environment. Real mail delivery is not configured.",
      "ConfigurationError",
      503,
    );
  }

  if (looksLikeBrevoSmtpSecret(env.BREVO_API_KEY)) {
    return validationError(
      request,
      env,
      "BREVO_API_KEY is using an SMTP secret. Replace it with your Brevo HTTP API key (xkeysib-...) for real mail delivery.",
      "ConfigurationError",
      503,
    );
  }

  const sender = resolveRequestedSender(env, body.from, body.fromName);
  if ("error" in sender) {
    return validationError(request, env, sender.error, "SenderRejected", 400);
  }

  const delivery = await sendBrevoEmail(env, {
    sender,
    to: body.to.map((email) => ({ email })),
    subject: body.subject.trim(),
    htmlContent: `<div style="font-family:Arial,sans-serif;white-space:pre-wrap;">${body.body
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\n/g, "<br/>")}</div>`,
    textContent: body.body,
  });

  return jsonResponse(request, env, {
    success: true,
    message: "Mail delivered through Brevo.",
    queued: false,
    id: delivery.messageId || `mail_${crypto.randomUUID()}`,
  });
}

function handleNotFound(request, env) {
  return jsonResponse(
    request,
    env,
    {
      success: false,
      errorType: "NotFound",
      message: "Route not found.",
    },
    { status: 404 },
  );
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(request, env),
      });
    }

    const url = new URL(request.url);

    if (url.pathname === "/" || url.pathname === "/health" || url.pathname === "/api/v1/health") {
      return jsonResponse(request, env, {
        success: true,
        status: "online",
        runtime: "cloudflare-worker",
        message: "VelisMail edge backend is running.",
        timestamp: new Date().toISOString(),
      });
    }

    if (request.method === "POST" && url.pathname === "/api/v1/auth/register") {
      return handleRegister(request, env);
    }

    if (
      request.method === "POST" &&
      (url.pathname === "/api/v1/auth/login/zkp" || url.pathname === "/api/v1/auth/login/passkey")
    ) {
      return handleLogin(request, env);
    }

    if (request.method === "POST" && url.pathname === "/api/v1/auth/send-otp") {
      return handleSendOtp(request, env);
    }

    if (request.method === "POST" && url.pathname === "/api/v1/auth/verify-otp") {
      return handleVerifyOtp(request, env);
    }

    if (request.method === "POST" && url.pathname === "/api/v1/verify") {
      return handleVerifyInfrastructure(request, env);
    }

    if (request.method === "POST" && url.pathname === "/api/v1/tenants/verify-domain") {
      return handleVerifyDomain(request, env);
    }

    if (request.method === "POST" && url.pathname === "/api/v1/mail/send") {
      return handleSendMail(request, env);
    }

    return handleNotFound(request, env);
  },
};
