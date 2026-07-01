#!/usr/bin/env node

import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TELEGRAM_API_BASE_URL = "https://api.telegram.org";
const LOCAL_API_URL_DEFAULT = "http://127.0.0.1:3000";
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_BOT_PROFILE_PHOTO_PATH = path.resolve(SCRIPT_DIR, "../assets/telegram-bot-avatar.jpg");
const BOT_PROFILE_PHOTO_ATTACH_NAME = "profile_photo";
const BOT_PROFILE_PHOTO_MAX_BYTES = 10 * 1024 * 1024;
const HEALTH_PATH = "/health";
const WEBHOOK_PATH = "/v1/integrations/telegram/webhook";
const ALLOWED_UPDATES = ["message"];
const BOT_PROFILE = {
  name: "Sivraj Memory",
  shortDescription: "Drop links, files, screenshots, and memories. Ask, correct, and capsule your Twin.",
  description: [
    "Sivraj is your private memory dropbox and Twin in Telegram.",
    "",
    "Send links, screenshots, PDFs, docs, CSVs, and notes to capture them. Ask with /ask, build context with /capsule, fix memory with /correct or /forget, and manage the linked account with /status or /unlink.",
  ].join("\n"),
};
const BOT_COMMANDS = [
  {
    command: "start",
    description: "Start or link your Sivraj Twin",
  },
  {
    command: "ask",
    description: "Ask your Twin from memory",
  },
  {
    command: "capsule",
    description: "Build a context capsule",
  },
  {
    command: "remember",
    description: "Save a memory explicitly",
  },
  {
    command: "forget",
    description: "Stop using a stale memory",
  },
  {
    command: "correct",
    description: "Correct a remembered fact",
  },
  {
    command: "stale",
    description: "Mark a memory as outdated",
  },
  {
    command: "status",
    description: "Show linked Twin status",
  },
  {
    command: "whoami",
    description: "Show linked Telegram account status",
  },
  {
    command: "switch",
    description: "Move Telegram to another Sivraj account",
  },
  {
    command: "unlink",
    description: "Disconnect Telegram from Sivraj",
  },
  {
    command: "help",
    description: "Show what this bot can do",
  },
];

loadNearestEnv(import.meta.url);

const [command = "help", ...args] = process.argv.slice(2);

try {
  switch (command) {
    case "check-env":
      checkEnv();
      break;
    case "commands:get":
      await getBotCommands();
      break;
    case "commands:set":
      await setBotCommands(args);
      break;
    case "get-me":
      await getMe();
      break;
    case "health":
      await runHealthCheck(args);
      break;
    case "info":
      await getWebhookInfo();
      break;
    case "production:setup":
      await setupProductionTelegram(args);
      break;
    case "set":
      await setWebhook(args);
      break;
    case "delete":
      await deleteWebhook(args);
      break;
    case "poll":
      await pollTelegramUpdates(args);
      break;
    case "profile:get":
      await getBotProfile();
      break;
    case "profile:set":
      await setBotProfile(args);
      break;
    case "help":
    case "--help":
    case "-h":
      printUsage();
      break;
    default:
      console.error(`Unknown command: ${command}`);
      printUsage();
      process.exitCode = 1;
  }
} catch (error) {
  reportError(error);
  process.exitCode = 1;
}

function checkEnv() {
  const env = readTelegramEnv({ requireSecret: false });
  const token = env.botToken;
  const secret = env.webhookSecret;
  const username = env.botUsername;
  const ttl = process.env["TELEGRAM_LINK_TOKEN_TTL_SECONDS"]?.trim() || "900";

  const rows = [
    formatEnvRow("TELEGRAM_BOT_TOKEN", Boolean(token), token ? `${token.length} chars` : null),
    formatEnvRow("TELEGRAM_BOT_USERNAME", Boolean(username), username || null),
    formatEnvRow("TELEGRAM_WEBHOOK_SECRET", Boolean(secret), secret ? `${secret.length} chars` : null),
    formatEnvRow("TELEGRAM_LINK_TOKEN_TTL_SECONDS", Boolean(ttl), ttl),
  ];

  console.log("Telegram environment:");
  for (const row of rows) {
    console.log(`  ${row}`);
  }

  const failures = [];
  if (!token) {
    failures.push("TELEGRAM_BOT_TOKEN is required.");
  }
  if (!username) {
    failures.push("TELEGRAM_BOT_USERNAME is required for web deep links.");
  }
  if (!secret) {
    failures.push("TELEGRAM_WEBHOOK_SECRET is required for webhook verification.");
  } else if (!isValidTelegramSecret(secret)) {
    failures.push("TELEGRAM_WEBHOOK_SECRET must contain only A-Z, a-z, 0-9, underscore, and hyphen, and be at most 256 chars.");
  }
  if (username && !isLikelyTelegramUsername(username)) {
    failures.push("TELEGRAM_BOT_USERNAME should be the bot username without @.");
  }
  if (!isPositiveInteger(ttl)) {
    failures.push("TELEGRAM_LINK_TOKEN_TTL_SECONDS must be a positive integer.");
  }

  if (failures.length > 0) {
    console.error("");
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log("");
  console.log("Telegram env looks ready for local testing.");
}

async function getMe() {
  const env = readTelegramEnv({ requireSecret: false });
  const result = await telegramRequest(env.botToken, "getMe", {});
  const username = result.username ? String(result.username) : "";
  const configuredUsername = env.botUsername || "";

  console.log("Telegram bot:");
  console.log(`  id: ${result.id}`);
  console.log(`  username: ${username ? `@${username}` : "<missing>"}`);
  console.log(`  first_name: ${result.first_name || "<missing>"}`);

  if (configuredUsername && username && configuredUsername !== username) {
    console.log(`  env match: no, TELEGRAM_BOT_USERNAME is ${configuredUsername}`);
    process.exitCode = 1;
    return;
  }

  console.log(`  env match: ${configuredUsername ? "yes" : "not checked"}`);
}

async function getBotCommands() {
  const env = readTelegramEnv({ requireSecret: false });
  const commands = await telegramRequest(env.botToken, "getMyCommands", {
    scope: { type: "default" },
  });

  console.log("Telegram bot commands:");
  printBotCommands(commands);
}

async function setBotCommands(commandArgs) {
  const dryRun = hasFlag(commandArgs, "--dry-run");

  if (dryRun) {
    console.log("Telegram bot commands dry run:");
    printBotCommands(BOT_COMMANDS);
    return;
  }

  const result = await applyBotCommands();

  console.log(`Telegram bot commands set: ${String(result)}`);
  printBotCommands(BOT_COMMANDS);
}

async function getBotProfile() {
  const env = readTelegramEnv({ requireSecret: false });
  const profile = await readBotProfile(env.botToken);

  console.log("Telegram bot profile:");
  printBotProfile(profile);
}

async function setBotProfile(commandArgs) {
  const dryRun = hasFlag(commandArgs, "--dry-run");
  const includePhoto = shouldSetProfilePhoto(commandArgs);
  const photoPath = readProfilePhotoPath(commandArgs);

  if (dryRun) {
    console.log("Telegram bot profile dry run:");
    printBotProfile(BOT_PROFILE);
    printProfilePhotoPlan({ includePhoto, photoPath });
    return;
  }

  const result = await applyBotProfile({ includePhoto, photoPath });

  console.log("Telegram bot profile set:");
  console.log(`  name: ${String(result.name)}`);
  console.log(`  short description: ${String(result.shortDescription)}`);
  console.log(`  description: ${String(result.description)}`);
  console.log(`  profile photo: ${result.photo === null ? "skipped" : String(result.photo)}`);
}

async function applyBotCommands() {
  const env = readTelegramEnv({ requireSecret: false });

  return telegramRequest(env.botToken, "setMyCommands", {
    commands: BOT_COMMANDS,
    scope: { type: "default" },
  });
}

async function readBotProfile(botToken) {
  const [name, shortDescription, description] = await Promise.all([
    telegramRequest(botToken, "getMyName", {}),
    telegramRequest(botToken, "getMyShortDescription", {}),
    telegramRequest(botToken, "getMyDescription", {}),
  ]);

  return {
    name: String(name?.name ?? ""),
    shortDescription: String(shortDescription?.short_description ?? ""),
    description: String(description?.description ?? ""),
  };
}

async function applyBotProfile(input) {
  const env = readTelegramEnv({ requireSecret: false });
  assertBotProfile(BOT_PROFILE);

  const [nameResult, shortDescriptionResult, descriptionResult] = await Promise.all([
    telegramRequest(env.botToken, "setMyName", {
      name: BOT_PROFILE.name,
    }),
    telegramRequest(env.botToken, "setMyShortDescription", {
      short_description: BOT_PROFILE.shortDescription,
    }),
    telegramRequest(env.botToken, "setMyDescription", {
      description: BOT_PROFILE.description,
    }),
  ]);

  const photoResult = input.includePhoto
    ? await applyBotProfilePhoto({
      botToken: env.botToken,
      photoPath: input.photoPath,
    })
    : null;

  return {
    name: nameResult,
    shortDescription: shortDescriptionResult,
    description: descriptionResult,
    photo: photoResult,
  };
}

async function applyBotProfilePhoto(input) {
  const photo = readProfilePhoto(input.photoPath);
  const formData = new FormData();

  formData.append("photo", JSON.stringify({
    type: "static",
    photo: `attach://${BOT_PROFILE_PHOTO_ATTACH_NAME}`,
  }));
  formData.append(
    BOT_PROFILE_PHOTO_ATTACH_NAME,
    new Blob([photo.bytes], { type: "image/jpeg" }),
    path.basename(input.photoPath),
  );

  return telegramMultipartRequest(input.botToken, "setMyProfilePhoto", formData);
}

async function getWebhookInfo() {
  const env = readTelegramEnv({ requireSecret: false });
  const info = await telegramRequest(env.botToken, "getWebhookInfo", {});

  console.log("Telegram webhook:");
  console.log(`  url: ${info.url || "<none>"}`);
  console.log(`  pending updates: ${info.pending_update_count ?? 0}`);
  console.log(`  allowed updates: ${formatAllowedUpdates(info.allowed_updates)}`);
  console.log(`  custom certificate: ${String(Boolean(info.has_custom_certificate))}`);

  if (info.last_error_message) {
    console.log(`  last error: ${info.last_error_message}`);
  }
}

async function setWebhook(commandArgs) {
  const webhookUrl = readWebhookUrl(commandArgs, {
    requireHttps: true,
    required: true,
  });
  const dropPendingUpdates = hasFlag(commandArgs, "--drop-pending-updates");

  if (hasFlag(commandArgs, "--dry-run")) {
    console.log("Telegram webhook dry run:");
    console.log(`  url: ${webhookUrl}`);
    console.log(`  allowed updates: ${ALLOWED_UPDATES.join(", ")}`);
    console.log(`  drop pending updates: ${String(dropPendingUpdates)}`);
    return;
  }

  const result = await applyWebhook({
    webhookUrl,
    dropPendingUpdates,
  });

  console.log(`Webhook set: ${String(result)}`);
  console.log(`  url: ${webhookUrl}`);
}

async function applyWebhook(input) {
  const env = readTelegramEnv({ requireSecret: true });

  return telegramRequest(env.botToken, "setWebhook", {
    url: input.webhookUrl,
    secret_token: env.webhookSecret,
    allowed_updates: ALLOWED_UPDATES,
    drop_pending_updates: input.dropPendingUpdates,
  });
}

async function deleteWebhook(commandArgs) {
  const env = readTelegramEnv({ requireSecret: false });
  const result = await telegramRequest(env.botToken, "deleteWebhook", {
    drop_pending_updates: hasFlag(commandArgs, "--drop-pending-updates"),
  });

  console.log(`Webhook deleted: ${String(result)}`);
}

async function setupProductionTelegram(commandArgs) {
  const webhookUrl = readWebhookUrl(commandArgs, {
    requireHttps: true,
    required: true,
  });
  const dropPendingUpdates = hasFlag(commandArgs, "--drop-pending-updates");
  const includeProfilePhoto = shouldSetProfilePhoto(commandArgs);
  const profilePhotoPath = readProfilePhotoPath(commandArgs);
  const dryRun = hasFlag(commandArgs, "--dry-run");

  console.log("Configuring Telegram production bot surface...");
  if (dryRun) {
    console.log("  dry run: true");
    console.log("  profile:");
    printBotProfile(BOT_PROFILE);
    printProfilePhotoPlan({ includePhoto: includeProfilePhoto, photoPath: profilePhotoPath });
    console.log("  command menu:");
    printBotCommands(BOT_COMMANDS);
    console.log(`  webhook url: ${webhookUrl}`);
    console.log(`  allowed updates: ${ALLOWED_UPDATES.join(", ")}`);
    console.log(`  drop pending updates: ${String(dropPendingUpdates)}`);
    return;
  }

  const profileResult = await applyBotProfile({
    includePhoto: includeProfilePhoto,
    photoPath: profilePhotoPath,
  });
  console.log(`  profile name set: ${String(profileResult.name)}`);
  console.log(`  profile short description set: ${String(profileResult.shortDescription)}`);
  console.log(`  profile description set: ${String(profileResult.description)}`);
  console.log(`  profile photo: ${profileResult.photo === null ? "skipped" : String(profileResult.photo)}`);

  const commandsResult = await applyBotCommands();
  console.log(`  commands set: ${String(commandsResult)}`);

  const webhookResult = await applyWebhook({
    webhookUrl,
    dropPendingUpdates,
  });
  console.log(`  webhook set: ${String(webhookResult)}`);
  console.log(`  webhook url: ${webhookUrl}`);
  console.log("");

  await runHealthCheck(["--url", webhookUrl, "--require-webhook"]);
}

async function runHealthCheck(commandArgs) {
  const rows = [];
  const webhookUrl = readWebhookUrl(commandArgs, {
    requireHttps: false,
    required: false,
  });
  const requireWebhook = hasFlag(commandArgs, "--require-webhook") || Boolean(webhookUrl);
  const apiBaseUrl = webhookUrl ? webhookUrl.slice(0, -WEBHOOK_PATH.length) : null;

  let env = null;
  try {
    env = readTelegramEnv({ requireSecret: requireWebhook });
    rows.push(healthRow("env", "pass", "Telegram env vars are present and well-formed."));
  } catch (error) {
    rows.push(healthRow("env", "fail", getErrorMessage(error)));
  }

  if (apiBaseUrl) {
    rows.push(await checkPublicApiHealth(apiBaseUrl));
  } else {
    rows.push(healthRow("api", "warn", "No --url provided, skipped public API /health check."));
  }

  if (!env) {
    printHealthRows(rows);
    process.exitCode = 1;
    return;
  }

  const bot = await telegramRequest(env.botToken, "getMe", {})
    .then((result) => ({ ok: true, result }))
    .catch((error) => ({ ok: false, error }));

  if (!bot.ok) {
    rows.push(healthRow("getMe", "fail", getErrorMessage(bot.error)));
  } else {
    const username = bot.result.username ? String(bot.result.username) : "";
    const usernameMatches = !env.botUsername || username === env.botUsername;
    rows.push(healthRow(
      "getMe",
      usernameMatches ? "pass" : "fail",
      usernameMatches
        ? `Bot @${username || "<missing>"} is reachable.`
        : `Telegram bot username @${username || "<missing>"} does not match TELEGRAM_BOT_USERNAME=${env.botUsername}.`,
    ));
  }

  const commands = await telegramRequest(env.botToken, "getMyCommands", {
    scope: { type: "default" },
  }).then((result) => ({ ok: true, result }))
    .catch((error) => ({ ok: false, error }));

  if (!commands.ok) {
    rows.push(healthRow("commands", "fail", getErrorMessage(commands.error)));
  } else {
    const commandDiff = diffBotCommands(commands.result);
    rows.push(healthRow(
      "commands",
      commandDiff.ok ? "pass" : "fail",
      commandDiff.ok
        ? `Command menu is registered: ${BOT_COMMANDS.map((command) => `/${command.command}`).join(", ")}.`
        : commandDiff.detail,
    ));
  }

  const profile = await readBotProfile(env.botToken)
    .then((result) => ({ ok: true, result }))
    .catch((error) => ({ ok: false, error }));

  if (!profile.ok) {
    rows.push(healthRow("profile", "fail", getErrorMessage(profile.error)));
  } else {
    const profileDiff = diffBotProfile(profile.result);
    rows.push(healthRow(
      "profile",
      profileDiff.ok ? "pass" : "fail",
      profileDiff.ok
        ? "Bot name, short description, and intro description match Sivraj defaults."
        : profileDiff.detail,
    ));
  }

  const webhook = await telegramRequest(env.botToken, "getWebhookInfo", {})
    .then((result) => ({ ok: true, result }))
    .catch((error) => ({ ok: false, error }));

  if (!webhook.ok) {
    rows.push(healthRow("webhook", "fail", getErrorMessage(webhook.error)));
  } else {
    rows.push(...telegramWebhookHealthRows({
      info: webhook.result,
      expectedWebhookUrl: webhookUrl,
      requireWebhook,
    }));
  }

  printHealthRows(rows);

  if (rows.some((row) => row.status === "fail")) {
    process.exitCode = 1;
  }
}

async function checkPublicApiHealth(apiBaseUrl) {
  const healthUrl = `${apiBaseUrl}${HEALTH_PATH}`;

  try {
    const response = await fetch(healthUrl);
    const body = await response.json().catch(() => null);

    if (response.ok && body?.ok === true) {
      return healthRow("api", "pass", `${healthUrl} returned ok.`);
    }

    return healthRow("api", "fail", `${healthUrl} returned ${response.status}.`);
  } catch (error) {
    return healthRow("api", "fail", `${healthUrl} is unreachable: ${getErrorMessage(error)}`);
  }
}

async function pollTelegramUpdates(commandArgs) {
  const env = readTelegramEnv({ requireSecret: true });
  const apiUrl = stripTrailingSlashes(readOption(commandArgs, "--api-url") ?? LOCAL_API_URL_DEFAULT);
  const webhookUrl = `${apiUrl}${WEBHOOK_PATH}`;
  let offset = readOffset(commandArgs);
  let stopped = false;

  process.on("SIGINT", () => {
    stopped = true;
    console.log("\nStopping Telegram local poller...");
  });

  console.log("Telegram local poller:");
  console.log(`  forwarding to: ${webhookUrl}`);
  console.log("  logging: update ids and handler results only");
  console.log("");

  while (!stopped) {
    const updates = await telegramRequest(env.botToken, "getUpdates", {
      timeout: 25,
      allowed_updates: ALLOWED_UPDATES,
      ...(offset > 0 ? { offset } : {}),
    });

    for (const update of updates) {
      if (stopped) {
        break;
      }

      offset = Math.max(offset, Number(update.update_id) + 1);
      await forwardUpdate({ update, webhookUrl, webhookSecret: env.webhookSecret });
    }
  }
}

async function forwardUpdate({ update, webhookUrl, webhookSecret }) {
  let response;
  try {
    response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-telegram-bot-api-secret-token": webhookSecret,
      },
      body: JSON.stringify(update),
    });
  } catch (error) {
    throw new Error(`local_api_unreachable:${webhookUrl}:${getErrorMessage(error)}`);
  }

  const body = await response.json().catch(() => null);
  const result = summarizeWebhookResponse(body);
  const kind = summarizeUpdate(update);

  console.log(`update ${update.update_id} (${kind}) -> ${response.status} ${result}`);

  if (!response.ok) {
    throw new Error(`local_webhook_failed:${response.status}:${result}`);
  }
}

async function telegramRequest(botToken, method, payload) {
  let response;
  try {
    response = await fetch(`${TELEGRAM_API_BASE_URL}/bot${botToken}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    throw new Error(`telegram_network_failed:${method}:${getErrorMessage(error)}`);
  }

  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.ok) {
    const description = body?.description || response.statusText || "unknown Telegram API error";
    const errorCode = body?.error_code || response.status;
    const hint = getTelegramErrorHint(method, description);
    throw new Error(`telegram_api_failed:${method}:${errorCode}:${description}${hint ? `\n${hint}` : ""}`);
  }

  return body.result;
}

async function telegramMultipartRequest(botToken, method, formData) {
  let response;
  try {
    response = await fetch(`${TELEGRAM_API_BASE_URL}/bot${botToken}/${method}`, {
      method: "POST",
      body: formData,
    });
  } catch (error) {
    throw new Error(`telegram_network_failed:${method}:${getErrorMessage(error)}`);
  }

  const body = await response.json().catch(() => null);
  if (!response.ok || !body?.ok) {
    const description = body?.description || response.statusText || "unknown Telegram API error";
    const errorCode = body?.error_code || response.status;
    const hint = getTelegramErrorHint(method, description);
    throw new Error(`telegram_api_failed:${method}:${errorCode}:${description}${hint ? `\n${hint}` : ""}`);
  }

  return body.result;
}

function getTelegramErrorHint(method, description) {
  if (method === "getUpdates" && /webhook/i.test(description)) {
    return "Hint: Telegram getUpdates cannot run while a webhook is configured. Run `pnpm --filter @sivraj/api telegram:webhook:delete` for local polling.";
  }

  return "";
}

function readTelegramEnv({ requireSecret }) {
  const botToken = process.env["TELEGRAM_BOT_TOKEN"]?.trim() ?? "";
  const botUsername = stripAt(process.env["TELEGRAM_BOT_USERNAME"]?.trim() ?? "");
  const webhookSecret = process.env["TELEGRAM_WEBHOOK_SECRET"]?.trim() ?? "";

  if (!botToken) {
    throw new Error("missing_env:TELEGRAM_BOT_TOKEN");
  }
  if (requireSecret && !webhookSecret) {
    throw new Error("missing_env:TELEGRAM_WEBHOOK_SECRET");
  }
  if (webhookSecret && !isValidTelegramSecret(webhookSecret)) {
    throw new Error("invalid_env:TELEGRAM_WEBHOOK_SECRET");
  }

  return { botToken, botUsername, webhookSecret };
}

function loadNearestEnv(fromUrl) {
  const startDir = path.dirname(fileURLToPath(fromUrl));
  const candidates = [
    path.join(process.cwd(), ".env"),
    ...ancestorDirs(startDir).map((dir) => path.join(dir, ".env")),
  ];
  const seen = new Set();

  for (const candidate of candidates) {
    if (seen.has(candidate)) {
      continue;
    }
    seen.add(candidate);

    if (existsSync(candidate)) {
      loadEnvFile(candidate);
      return;
    }
  }
}

function loadEnvFile(filePath) {
  const content = readFileSync(filePath, "utf8");

  for (const line of content.split(/\r?\n/)) {
    const parsed = parseEnvLine(line);

    if (!parsed || process.env[parsed.key] !== undefined) {
      continue;
    }

    process.env[parsed.key] = parsed.value;
  }
}

function parseEnvLine(line) {
  const trimmed = line.trim();

  if (!trimmed || trimmed.startsWith("#")) {
    return null;
  }

  const withoutExport = trimmed.startsWith("export ") ? trimmed.slice("export ".length).trim() : trimmed;
  const separator = withoutExport.indexOf("=");

  if (separator <= 0) {
    return null;
  }

  const key = withoutExport.slice(0, separator).trim();
  const rawValue = withoutExport.slice(separator + 1).trim();
  const value = rawValue.replace(/^['"]|['"]$/g, "");

  return { key, value };
}

function ancestorDirs(startDir) {
  const dirs = [];
  let current = startDir;

  while (true) {
    dirs.push(current);
    const parent = path.dirname(current);

    if (parent === current) {
      return dirs;
    }

    current = parent;
  }
}

function readWebhookUrl(commandArgs, options) {
  const rawUrl = readOption(commandArgs, "--url") ?? firstPositional(commandArgs);

  if (!rawUrl) {
    if (options.required) {
      throw new Error("missing_webhook_url: pass --url https://api.example.com or --url https://api.example.com/v1/integrations/telegram/webhook");
    }

    return null;
  }

  const webhookUrl = normalizeWebhookUrl(rawUrl);

  if (options.requireHttps && !webhookUrl.startsWith("https://")) {
    throw new Error("invalid_webhook_url: Telegram production webhooks must use https://");
  }

  return webhookUrl;
}

function normalizeWebhookUrl(rawUrl) {
  const url = stripTrailingSlashes(rawUrl.trim());

  return url.endsWith(WEBHOOK_PATH)
    ? url
    : `${url}${WEBHOOK_PATH}`;
}

function assertBotProfile(profile) {
  const errors = [];

  if (profile.name.length > 64) {
    errors.push("BOT_PROFILE.name must be at most 64 characters.");
  }
  if (profile.shortDescription.length > 120) {
    errors.push("BOT_PROFILE.shortDescription must be at most 120 characters.");
  }
  if (profile.description.length > 512) {
    errors.push("BOT_PROFILE.description must be at most 512 characters.");
  }

  if (errors.length > 0) {
    throw new Error(`invalid_bot_profile:${errors.join(" ")}`);
  }
}

function diffBotCommands(commands) {
  const actual = Array.isArray(commands) ? commands : [];
  const actualByName = new Map(actual.map((command) => [
    String(command.command),
    String(command.description),
  ]));
  const expectedByName = new Map(BOT_COMMANDS.map((command) => [
    command.command,
    command.description,
  ]));
  const missing = BOT_COMMANDS
    .filter((command) => !actualByName.has(command.command))
    .map((command) => `/${command.command}`);
  const unexpected = actual
    .filter((command) => !expectedByName.has(String(command.command)))
    .map((command) => `/${command.command}`);
  const changed = BOT_COMMANDS
    .filter((command) =>
      actualByName.has(command.command) &&
      actualByName.get(command.command) !== command.description
    )
    .map((command) => `/${command.command}`);

  if (missing.length === 0 && unexpected.length === 0 && changed.length === 0) {
    return { ok: true, detail: "" };
  }

  return {
    ok: false,
    detail: [
      missing.length ? `missing: ${missing.join(", ")}` : null,
      unexpected.length ? `unexpected: ${unexpected.join(", ")}` : null,
      changed.length ? `description drift: ${changed.join(", ")}` : null,
    ].filter(Boolean).join("; "),
  };
}

function diffBotProfile(profile) {
  const changed = [];

  if (profile.name !== BOT_PROFILE.name) {
    changed.push(`name is ${formatProfileValue(profile.name)}, expected ${formatProfileValue(BOT_PROFILE.name)}`);
  }
  if (profile.shortDescription !== BOT_PROFILE.shortDescription) {
    changed.push("short description differs from Sivraj default");
  }
  if (profile.description !== BOT_PROFILE.description) {
    changed.push("intro description differs from Sivraj default");
  }

  return changed.length === 0
    ? { ok: true, detail: "" }
    : { ok: false, detail: changed.join("; ") };
}

function telegramWebhookHealthRows(input) {
  const rows = [];
  const actualUrl = input.info.url || "";

  if (!actualUrl) {
    rows.push(healthRow(
      "webhook",
      input.requireWebhook ? "fail" : "warn",
      "No Telegram webhook is registered.",
    ));
  } else if (input.expectedWebhookUrl && actualUrl !== input.expectedWebhookUrl) {
    rows.push(healthRow(
      "webhook",
      "fail",
      `Registered webhook ${actualUrl} does not match expected ${input.expectedWebhookUrl}.`,
    ));
  } else {
    rows.push(healthRow("webhook", "pass", `Registered webhook: ${actualUrl}.`));
  }

  const allowedUpdates = Array.isArray(input.info.allowed_updates)
    ? input.info.allowed_updates
    : [];
  const missingAllowedUpdates = ALLOWED_UPDATES
    .filter((update) => allowedUpdates.length > 0 && !allowedUpdates.includes(update));

  rows.push(healthRow(
    "allowed_updates",
    missingAllowedUpdates.length === 0 ? "pass" : "fail",
    missingAllowedUpdates.length === 0
      ? `Allowed updates: ${formatAllowedUpdates(allowedUpdates)}.`
      : `Missing allowed updates: ${missingAllowedUpdates.join(", ")}.`,
  ));

  const pendingUpdates = Number(input.info.pending_update_count ?? 0);
  rows.push(healthRow(
    "pending_updates",
    pendingUpdates > 100 ? "warn" : "pass",
    `Telegram reports ${pendingUpdates} pending update${pendingUpdates === 1 ? "" : "s"}.`,
  ));

  if (input.info.last_error_message) {
    rows.push(healthRow("last_error", "fail", String(input.info.last_error_message)));
  }

  return rows;
}

function healthRow(name, status, detail) {
  return { name, status, detail };
}

function printHealthRows(rows) {
  console.log("Telegram production health:");

  for (const row of rows) {
    console.log(`  ${row.status.toUpperCase()} ${row.name}: ${row.detail}`);
  }

  const failed = rows.filter((row) => row.status === "fail").length;
  const warned = rows.filter((row) => row.status === "warn").length;

  console.log("");
  console.log(`Result: ${failed > 0 ? "failed" : "ready"} (${failed} failed, ${warned} warnings)`);
}

function readOffset(commandArgs) {
  const rawOffset = readOption(commandArgs, "--offset");
  if (!rawOffset) {
    return 0;
  }

  const offset = Number.parseInt(rawOffset, 10);
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw new Error("invalid_offset: --offset must be a non-negative integer");
  }

  return offset;
}

function readOption(commandArgs, optionName) {
  const index = commandArgs.indexOf(optionName);
  if (index === -1) {
    return null;
  }

  const value = commandArgs[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`missing_option_value:${optionName}`);
  }

  return value;
}

function hasFlag(commandArgs, flagName) {
  return commandArgs.includes(flagName);
}

function firstPositional(commandArgs) {
  return commandArgs.find((arg) => !arg.startsWith("--")) ?? null;
}

function summarizeWebhookResponse(body) {
  if (!body || typeof body !== "object") {
    return "ok";
  }

  return String(body.action ?? body.skipped ?? body.error ?? "ok");
}

function summarizeUpdate(update) {
  const message = update.message;
  if (!message) {
    return "non-message";
  }
  if (message.text) {
    return "text";
  }
  if (message.voice) {
    return "voice";
  }
  if (message.photo) {
    return "photo";
  }
  if (message.document) {
    return "document";
  }
  if (message.audio) {
    return "audio";
  }
  if (message.video) {
    return "video";
  }
  return "message";
}

function reportError(error) {
  console.error(getErrorMessage(error));
}

function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function formatEnvRow(key, isPresent, detail) {
  return `${key}: ${isPresent ? "set" : "missing"}${detail ? ` (${detail})` : ""}`;
}

function formatAllowedUpdates(value) {
  if (!Array.isArray(value) || value.length === 0) {
    return "<default>";
  }

  return value.join(", ");
}

function printBotCommands(commands) {
  if (!Array.isArray(commands) || commands.length === 0) {
    console.log("  <none>");
    return;
  }

  for (const command of commands) {
    console.log(`  /${command.command} - ${command.description}`);
  }
}

function printBotProfile(profile) {
  console.log(`  name: ${profile.name}`);
  console.log(`  short description: ${profile.shortDescription}`);
  console.log("  description:");
  for (const line of profile.description.split("\n")) {
    console.log(`    ${line}`);
  }
}

function printProfilePhotoPlan(input) {
  if (input.includePhoto) {
    console.log(`  profile photo: ${input.photoPath}`);
    return;
  }

  console.log("  profile photo: skipped (pass --with-profile-photo to update it)");
}

function readProfilePhotoPath(commandArgs) {
  const customPath = readOption(commandArgs, "--photo");

  return customPath
    ? path.resolve(process.cwd(), customPath)
    : DEFAULT_BOT_PROFILE_PHOTO_PATH;
}

function shouldSetProfilePhoto(commandArgs) {
  return hasFlag(commandArgs, "--with-profile-photo") ||
    hasFlag(commandArgs, "--with-photo") ||
    Boolean(readOption(commandArgs, "--photo"));
}

function readProfilePhoto(photoPath) {
  if (!existsSync(photoPath)) {
    throw new Error(`missing_profile_photo:${photoPath}`);
  }

  const stats = statSync(photoPath);
  if (!stats.isFile()) {
    throw new Error(`invalid_profile_photo:not_a_file:${photoPath}`);
  }
  if (stats.size <= 0 || stats.size > BOT_PROFILE_PHOTO_MAX_BYTES) {
    throw new Error(`invalid_profile_photo:size:${stats.size}`);
  }
  if (!/\.jpe?g$/i.test(photoPath)) {
    throw new Error("invalid_profile_photo: Telegram static bot profile photos must be .jpg or .jpeg");
  }

  return {
    bytes: readFileSync(photoPath),
    size: stats.size,
  };
}

function formatProfileValue(value) {
  return value ? JSON.stringify(value) : "<empty>";
}

function stripAt(value) {
  return value.startsWith("@") ? value.slice(1) : value;
}

function stripTrailingSlashes(value) {
  return value.replace(/\/+$/g, "");
}

function isLikelyTelegramUsername(value) {
  return /^[A-Za-z0-9_]{5,32}$/.test(stripAt(value));
}

function isValidTelegramSecret(value) {
  return /^[A-Za-z0-9_-]{1,256}$/.test(value);
}

function isPositiveInteger(value) {
  return /^[1-9][0-9]*$/.test(value);
}

function printUsage() {
  console.log(`
Telegram bot local tooling

Commands:
  check-env
    Validate Telegram env vars without printing secrets.

  get-me
    Call Telegram getMe and confirm TELEGRAM_BOT_USERNAME matches the bot.

  commands:get
    Show the command menu currently registered with Telegram.

  commands:set [--dry-run]
    Register Sivraj bot commands so Telegram clients autocomplete them after "/".

  profile:get
    Show the current Telegram bot name, short description, and intro description.

  profile:set [--with-profile-photo] [--photo ./avatar.jpg] [--dry-run]
    Register Sivraj bot name, profile short description, empty-chat intro, and optionally the bot avatar.

  health [--url https://api.example.com] [--require-webhook]
    Verify Telegram env, bot identity, profile copy, command menu, webhook state, and public API health.

  production:setup --url https://api.example.com [--with-profile-photo] [--drop-pending-updates] [--dry-run]
    Register the bot profile, command menu, production webhook, then run health checks.

  info
    Show Telegram webhook configuration.

  set --url https://api.example.com [--dry-run]
    Register the production webhook using TELEGRAM_WEBHOOK_SECRET.

  delete [--drop-pending-updates]
    Remove the configured Telegram webhook. Useful before local polling.

  poll [--api-url http://127.0.0.1:3000] [--offset 123]
    Long-poll Telegram and forward updates into the local API webhook route.

Examples:
  pnpm --filter @sivraj/api telegram:check
  pnpm --filter @sivraj/api telegram:get-me
  pnpm --filter @sivraj/api telegram:profile:set -- --with-profile-photo
  pnpm --filter @sivraj/api telegram:commands:set
  pnpm --filter @sivraj/api telegram:production:setup -- --url https://api.example.com
  pnpm --filter @sivraj/api telegram:health -- --url https://api.example.com
  pnpm --filter @sivraj/api telegram:poll -- --api-url http://127.0.0.1:3000
`);
}
