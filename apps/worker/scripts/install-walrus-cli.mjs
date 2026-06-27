#!/usr/bin/env node

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, mkdirSync, rmSync } from "node:fs";
import https from "node:https";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const workerDir = path.resolve(scriptDir, "..");

const version = "testnet-v1.50.0";
const assetName = "walrus-testnet-v1.50.0-ubuntu-x86_64.tgz";
const expectedSha256 = "24ebb249d0a2eedfcb00d9c7ce8f18b9da0fd8d9fc5970ef49ca6d968162fe71";
const downloadUrl = `https://github.com/MystenLabs/walrus/releases/download/${version}/${assetName}`;
const binDir = path.join(workerDir, "bin");
const walrusBin = path.join(binDir, "walrus");
const archivePath = path.join(binDir, assetName);

if (process.platform !== "linux" || process.arch !== "x64") {
  console.log(`Skipping Walrus CLI install for ${process.platform}/${process.arch}.`);
  process.exit(0);
}

mkdirSync(binDir, { recursive: true });

if (existsSync(walrusBin)) {
  const installedVersion = await readInstalledVersion(walrusBin);
  if (installedVersion.includes("1.50.0-dac31b8cb87c")) {
    console.log(`Walrus CLI already installed at ${walrusBin}: ${installedVersion}`);
    process.exit(0);
  }
}

console.log(`Downloading ${downloadUrl}`);
await downloadFile(downloadUrl, archivePath);

const actualSha256 = await sha256File(archivePath);
if (actualSha256 !== expectedSha256) {
  rmSync(archivePath, { force: true });
  throw new Error(`Walrus CLI checksum mismatch: expected ${expectedSha256}, got ${actualSha256}`);
}

await execFileAsync("tar", ["-xzf", archivePath, "-C", binDir, "./walrus"], {
  maxBuffer: 1024 * 1024,
});
await execFileAsync("chmod", ["0755", walrusBin], {
  maxBuffer: 1024 * 1024,
});
rmSync(archivePath, { force: true });

console.log(`Installed Walrus CLI at ${walrusBin}`);

async function readInstalledVersion(binaryPath) {
  try {
    const { stdout } = await execFileAsync(binaryPath, ["--version"], {
      maxBuffer: 1024 * 1024,
    });
    return stdout.trim();
  } catch {
    return "";
  }
}

function downloadFile(url, targetPath, redirectCount = 0) {
  if (redirectCount > 5) {
    return Promise.reject(new Error("Too many redirects while downloading Walrus CLI"));
  }

  return new Promise((resolve, reject) => {
    const request = https.get(url, (response) => {
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        resolve(downloadFile(response.headers.location, targetPath, redirectCount + 1));
        return;
      }

      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`Walrus CLI download failed with HTTP ${response.statusCode}`));
        return;
      }

      const file = createWriteStream(targetPath, { mode: 0o600 });
      response.pipe(file);
      file.on("finish", () => {
        file.close(resolve);
      });
      file.on("error", reject);
    });

    request.on("error", reject);
  });
}

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const fileStream = createReadStream(filePath);

    fileStream.on("data", (chunk) => hash.update(chunk));
    fileStream.on("end", () => resolve(hash.digest("hex")));
    fileStream.on("error", reject);
  });
}
