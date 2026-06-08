export const CONNECTOR_PROVIDERS = [
  { value: "github", label: "GitHub" },
  { value: "browser_history", label: "Browser history" },
  { value: "slack", label: "Slack" },
  { value: "email", label: "Email" },
  { value: "notion", label: "Notion" },
  { value: "google_drive", label: "Google Drive" },
  { value: "microsoft_onedrive", label: "Microsoft OneDrive" },
  { value: "calendar", label: "Calendar" },
  { value: "chatgpt", label: "ChatGPT" },
  { value: "codex", label: "Codex" },
  { value: "claude", label: "Claude" },
] as const;

export const CONNECTOR_PROVIDER_DEFAULTS: Record<
  string,
  { label: string; sourceId: string; sourceName: string; sourceUri: string }
> = {
  github: {
    label: "GitHub repository sync",
    sourceId: "github:owner/repo",
    sourceName: "owner/repo",
    sourceUri: "https://github.com/owner/repo",
  },
  notion: {
    label: "Notion page sync",
    sourceId: "notion-page-id",
    sourceName: "Notion page",
    sourceUri:
      "https://www.notion.so/workspace/Page-00000000000000000000000000000000",
  },
  browser_history: {
    label: "Browser history import",
    sourceId: "browser-history",
    sourceName: "Browser history",
    sourceUri: "",
  },
  slack: {
    label: "Slack workspace sync",
    sourceId: "C1234567890",
    sourceName: "Slack channel",
    sourceUri: "",
  },
  email: {
    label: "Gmail inbox sync",
    sourceId: "gmail:inbox",
    sourceName: "Gmail inbox",
    sourceUri: "gmail://me",
  },
  calendar: {
    label: "Google Calendar sync",
    sourceId: "primary",
    sourceName: "Primary calendar",
    sourceUri: "google-calendar://primary",
  },
  google_drive: {
    label: "Google Drive folder sync",
    sourceId: "root",
    sourceName: "Google Drive folder",
    sourceUri: "google-drive://root",
  },
  microsoft_onedrive: {
    label: "OneDrive folder sync",
    sourceId: "root",
    sourceName: "OneDrive folder",
    sourceUri: "microsoft-onedrive://root",
  },
};
