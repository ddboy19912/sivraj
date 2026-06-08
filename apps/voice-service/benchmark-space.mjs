import { readEnv } from "./benchmark-env.mjs";
import { benchmarkVoiceRequest } from "./benchmark-helpers.mjs";

const env = readEnv();
const serviceUrl = (env.VOICE_SERVICE_URL ?? "").replace(/\/+$/, "");
const apiKey = env.VOICE_SERVICE_API_KEY ?? "";

if (!serviceUrl) {
  throw new Error("VOICE_SERVICE_URL is missing from .env");
}

const cases = [
  ["short-1", "Hello from Sivraj."],
  ["short-2", "Hello from Sivraj."],
  [
    "longer",
    "Hello from Sivraj. I am testing voice latency for a Jarvis style assistant response.",
  ],
];

for (const [label, text] of cases) {
  const result = await benchmarkVoiceRequest(serviceUrl, label, text, apiKey);
  console.log(JSON.stringify(result));
}
