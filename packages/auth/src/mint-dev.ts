import "dotenv/config";
import { signSessionToken, loadAuthConfig } from "./index.js";

const token = await signSessionToken(
  {
    sub: process.env["DEV_AUTH_SUB"] || "00000000-0000-0000-0000-000000000000",
    type: "user",
    scopes: (process.env["DEV_AUTH_SCOPES"] || "artifact:upload").split(","),
    twinId: process.env["DEV_AUTH_TWIN_ID"],
    walletAddress: process.env["DEV_AUTH_WALLET_ADDRESS"],
  },
  loadAuthConfig(process.env),
  process.env["DEV_AUTH_EXPIRES_IN"] || "1h",
);

console.log(token);
