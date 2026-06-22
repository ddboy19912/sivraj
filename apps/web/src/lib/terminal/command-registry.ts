import type { TerminalCommandId } from "@/types/terminal.types";

type TerminalCommandDefinition = {
  id: TerminalCommandId;
  usage: string;
  description: string;
};

const TERMINAL_COMMANDS: TerminalCommandDefinition[] = [
  {
    id: "help",
    usage: "help",
    description: "List supported terminal commands.",
  },
  {
    id: "clear",
    usage: "clear",
    description: "Clear terminal output.",
  },
  {
    id: "whoami",
    usage: "whoami",
    description: "Show the current wallet, twin, and API session expiry.",
  },
  {
    id: "onboarding.status",
    usage: "onboarding status",
    description: "Show onboarding lifecycle state for the signed-in twin.",
  },
  {
    id: "onboarding.reset",
    usage: "onboarding reset --dry-run",
    description: "Preview onboarding reset changes. Dry run is the default.",
  },
  {
    id: "onboarding.reset",
    usage: "onboarding reset --confirm",
    description: "Reset onboarding and reload into the onboarding flow.",
  },
  {
    id: "session.clear",
    usage: "session clear",
    description: "Clear the browser session and onboarding completion cache.",
  },
  {
    id: "account.wipe",
    usage: "account wipe --dry-run",
    description: "Preview the current wallet account wipe.",
  },
  {
    id: "account.wipe",
    usage: "account wipe",
    description: "Wipe the current wallet account after a Y/N confirmation.",
  },
  {
    id: "connectors.list",
    usage: "connectors list",
    description: "List connector accounts for the current twin.",
  },
  {
    id: "connectors.sync",
    usage: "connectors sync <accountId>",
    description: "Queue a manual connector sync.",
  },
  {
    id: "audit.recent",
    usage: "audit recent [limit]",
    description: "Show recent audit events, capped at 25.",
  },
];

export function formatHelpLines() {
  return TERMINAL_COMMANDS.map((command) => ({
    kind: "help" as const,
    text: `${command.usage} ${command.description}`,
    command: command.usage,
    description: command.description,
  }));
}
