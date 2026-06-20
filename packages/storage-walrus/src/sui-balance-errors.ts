function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function readExecutionMessage(error: unknown): string {
  const executionError = typeof error === "object" && error !== null
    ? (error as { executionError?: unknown }).executionError
    : null;
  const executionMessage = typeof executionError === "object" && executionError !== null
    ? (executionError as { message?: unknown }).message
    : null;

  return typeof executionMessage === "string" ? executionMessage : "";
}

function readMoveAbortCode(error: unknown): string | number | null {
  const executionError = typeof error === "object" && error !== null
    ? (error as { executionError?: unknown }).executionError
    : null;
  const moveAbort = typeof executionError === "object" && executionError !== null
    ? (executionError as { MoveAbort?: unknown }).MoveAbort
    : null;
  const abortCode = typeof moveAbort === "object" && moveAbort !== null
    ? (moveAbort as { abortCode?: unknown }).abortCode
    : null;

  return typeof abortCode === "string" || typeof abortCode === "number" ? abortCode : null;
}

export function isSuiBalanceSplitAbort(error: unknown): boolean {
  const message = `${errorMessage(error)} ${readExecutionMessage(error)}`;
  const abortCode = readMoveAbortCode(error);

  return message.includes("balance::split") &&
    (message.includes("abort code: 2") || abortCode === "2" || abortCode === 2);
}

export function isSuiInsufficientBalanceError(error: unknown): boolean {
  const message = `${errorMessage(error)} ${readExecutionMessage(error)}`.toLowerCase();

  return isSuiBalanceSplitAbort(error) ||
    (
      message.includes("insufficient sui balance") &&
      (
        message.includes("gas selection") ||
        message.includes("required budget") ||
        message.includes("address balance") ||
        message.includes("coins")
      )
    );
}
