import {
  PARSED_BROWSER_HISTORY_EMPTY,
  PARSED_CHAT_EXPORT_EMPTY,
  PARSED_CSV_EMPTY,
  PARSED_DOCX_EMPTY,
  PARSED_EMAIL_EMPTY,
  PARSED_GITHUB_EMPTY,
  PARSED_IMAGE_EMPTY,
  PARSED_MARKDOWN_EMPTY,
  PARSED_OCR_PDF_EMPTY,
  PARSED_PLAIN_TEXT_EMPTY,
  PARSED_URL_EMPTY,
  PARSED_SLACK_EXPORT_EMPTY,
  PARSED_WHATSAPP_EXPORT_EMPTY,
} from "./constants.js";

const SOURCE_LABELS: Record<string, string> = {
  markdown: "Markdown",
  upload: "Plain text",
  docx: "DOCX",
  csv: "CSV",
  email: "Email",
  ocr_pdf: "OCR scanned PDF",
  image: "Image",
  url: "URL",
  voice_note: "Voice note",
  voice_conversation: "Voice conversation",
  github: "GitHub import",
  browser_history: "Browser history",
  chat_export: "Chat export",
  slack_export: "Slack export",
  whatsapp_export: "WhatsApp export",
};

const EMPTY_PARSE_REASONS: Record<string, string> = {
  markdown: PARSED_MARKDOWN_EMPTY,
  upload: PARSED_PLAIN_TEXT_EMPTY,
  docx: PARSED_DOCX_EMPTY,
  csv: PARSED_CSV_EMPTY,
  email: PARSED_EMAIL_EMPTY,
  ocr_pdf: PARSED_OCR_PDF_EMPTY,
  image: PARSED_IMAGE_EMPTY,
  url: PARSED_URL_EMPTY,
  github: PARSED_GITHUB_EMPTY,
  browser_history: PARSED_BROWSER_HISTORY_EMPTY,
  chat_export: PARSED_CHAT_EXPORT_EMPTY,
  slack_export: PARSED_SLACK_EXPORT_EMPTY,
  whatsapp_export: PARSED_WHATSAPP_EXPORT_EMPTY,
};

export function readSourceLabel(sourceType: string): string {
  return SOURCE_LABELS[sourceType] ?? "Source";
}

export function readEmptyParseReason(sourceType: string): string | null {
  return EMPTY_PARSE_REASONS[sourceType] ?? null;
}
