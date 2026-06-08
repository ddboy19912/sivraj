export function requireConsoleSession(
  session: unknown,
  isSessionForWallet: boolean,
  setStatus: (status: string) => void,
  message = 'Sign in required.',
): session is NonNullable<typeof session> {
  if (!session || !isSessionForWallet) {
    setStatus(message)
    return false
  }

  return true
}
