import { asRecord } from "./shared/record.js";

type NotionBlock = {
  type?: string;
  [key: string]: unknown;
};

type NotionBlockRenderContext = {
  payload: Record<string, unknown>;
  richText: string;
  indent: string;
  type: string;
};

function renderNotionHeading(context: NotionBlockRenderContext): string | null {
  const level = Number(context.type.at(-1));
  return context.richText
    ? `${context.indent}${"#".repeat(level)} ${context.richText}`
    : null;
}

function renderNotionTodo(context: NotionBlockRenderContext): string | null {
  const checked = context.payload["checked"] === true ? "x" : " ";
  return context.richText
    ? `${context.indent}- [${checked}] ${context.richText}`
    : null;
}

function renderNotionCode(context: NotionBlockRenderContext): string | null {
  const language =
    typeof context.payload["language"] === "string"
      ? context.payload["language"]
      : "";
  return context.richText
    ? `${context.indent}\`\`\`${language}\n${context.richText}\n${context.indent}\`\`\``
    : null;
}

function renderNotionChildPage(context: NotionBlockRenderContext): string | null {
  const title =
    typeof context.payload["title"] === "string"
      ? context.payload["title"]
      : null;
  return title ? `${context.indent}Child page: ${title}` : null;
}

function renderNotionLinkBlock(context: NotionBlockRenderContext): string | null {
  const url =
    typeof context.payload["url"] === "string" ? context.payload["url"] : null;
  return [context.richText, url].filter(Boolean).join(" ");
}

const NOTION_BLOCK_RENDERERS: Record<
  string,
  (context: NotionBlockRenderContext) => string | null
> = {
  heading_1: renderNotionHeading,
  heading_2: renderNotionHeading,
  heading_3: renderNotionHeading,
  bulleted_list_item: (context) =>
    context.richText ? `${context.indent}- ${context.richText}` : null,
  numbered_list_item: (context) =>
    context.richText ? `${context.indent}1. ${context.richText}` : null,
  to_do: renderNotionTodo,
  quote: (context) =>
    context.richText ? `${context.indent}> ${context.richText}` : null,
  code: renderNotionCode,
  child_page: renderNotionChildPage,
  bookmark: renderNotionLinkBlock,
  embed: renderNotionLinkBlock,
  link_preview: renderNotionLinkBlock,
};

export function notionBlockToText(block: NotionBlock, depth: number): string | null {
  const type = block.type;

  if (!type) {
    return null;
  }

  const payload = asRecord(block[type]);
  const richText = readRichText(payload["rich_text"]);
  const context: NotionBlockRenderContext = {
    type,
    payload,
    richText,
    indent: "  ".repeat(depth),
  };
  const renderer = NOTION_BLOCK_RENDERERS[type];

  if (renderer) {
    return renderer(context);
  }

  return richText ? `${context.indent}${richText}` : null;
}

function readRichText(value: unknown): string {
  if (!Array.isArray(value)) {
    return "";
  }

  return value
    .map((item) => {
      const record = asRecord(item);
      const plain = record["plain_text"];

      return typeof plain === "string" ? plain : "";
    })
    .join("");
}
