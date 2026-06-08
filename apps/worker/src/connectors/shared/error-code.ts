import { errorMessage } from "./error-message.js";

export function connectorErrorCode(error: unknown): string {
  const message = errorMessage(error);
  return message.length > 0 ? message.slice(0, 80) : "connector_sync_failed";
}
