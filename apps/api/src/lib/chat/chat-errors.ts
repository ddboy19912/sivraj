export function isProviderConnectionTimeout(message: string): boolean {
  return message.includes("Cannot connect to API")
    || message.includes("Connect Timeout Error")
    || message.includes("UND_ERR_CONNECT_TIMEOUT");
}

export function readChatErrorCode(message: string): string {
  if (isProviderConnectionTimeout(message)) {
    return "llm_provider_unreachable";
  }
  return message.split(":")[0] || "chat_turn_failed";
}

/** Map internal failure codes to safe client-facing chat error messages. */
export function publicChatFailureMessage(message: string): string {
  if (isProviderConnectionTimeout(message)) {
    return "The model provider timed out before returning a response. Retry once your connection or provider is healthy.";
  }
  if (message.includes("llm_provider_not_configured")) {
    return "No chat model is configured for this twin yet.";
  }
  if (message.includes("chat_memory_intake_failed")) {
    return "I couldn’t save that memory before replying. Please retry.";
  }
  if (message.includes("storage_wallet_insufficient_balance")) {
    return "Private memory storage needs more SUI before it can save new memory.";
  }
  return message;
}
