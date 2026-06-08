import { fromMarkdown } from "mdast-util-from-markdown";
import type { ParsedArtifact } from "../types.js";

type MarkdownNode = {
  type?: string;
  value?: string;
  lang?: string | null;
  alt?: string | null;
  children?: MarkdownNode[];
};

const MARKDOWN_PARSER_NAME = "markdown";

export function parseMarkdown(input: {
  content: string;
  title?: string | null;
}): ParsedArtifact {
  const originalLength = input.content.length;
  const warnings: string[] = [];
  const withoutFrontmatter = stripFrontmatter(input.content);

  let root: MarkdownNode;

  try {
    root = fromMarkdown(withoutFrontmatter) as MarkdownNode;
  } catch {
    warnings.push("markdown_parse_recovered_with_plain_text");
    const recoveredContent = normalizeWhitespace(withoutFrontmatter);

    return {
      content: recoveredContent,
      parser: {
        name: MARKDOWN_PARSER_NAME,
        originalLength,
        parsedLength: recoveredContent.length,
        warnings,
      },
    };
  }

  const content = normalizeWhitespace(renderNode(root));

  if (!content) {
    warnings.push("markdown_empty_after_parse");
  }

  return {
    content,
    parser: {
      name: MARKDOWN_PARSER_NAME,
      originalLength,
      parsedLength: content.length,
      warnings,
    },
  };
}

function stripFrontmatter(content: string): string {
  if (!content.startsWith("---")) {
    return content;
  }

  const normalized = content.replace(/\r\n/g, "\n");
  const closingIndex = normalized.indexOf("\n---", 3);

  if (closingIndex === -1) {
    return content;
  }

  const afterClosing = normalized.slice(closingIndex + 4);

  return afterClosing.startsWith("\n") ? afterClosing.slice(1) : afterClosing;
}

const INLINE_CONTAINER_TYPES = new Set([
  "delete",
  "emphasis",
  "strong",
  "link",
  "linkReference",
  "heading",
  "paragraph",
]);

const BLOCK_CONTAINER_TYPES = new Set([
  "root",
  "blockquote",
  "table",
  "tableRow",
  "tableCell",
  "listItem",
]);

const IGNORED_TYPES = new Set([
  "html",
  "yaml",
  "definition",
  "footnoteDefinition",
]);

const LEAF_VALUE_TYPES = new Set(["text", "inlineCode"]);
const LINE_BREAK_TYPES = new Set(["thematicBreak", "break"]);
const MEDIA_TYPES = new Set(["image", "imageReference"]);

function renderLeafNode(node: MarkdownNode, type: string): string {
  if (LEAF_VALUE_TYPES.has(type)) {
    return node.value ?? "";
  }

  if (LINE_BREAK_TYPES.has(type)) {
    return "\n";
  }

  if (MEDIA_TYPES.has(type)) {
    return node.alt ?? "";
  }

  if (type === "code") {
    return renderCodeBlock(node);
  }

  return node.children ? renderChildren(node) : node.value ?? "";
}

function renderNode(node: MarkdownNode): string {
  const type = node.type ?? "";

  if (INLINE_CONTAINER_TYPES.has(type)) {
    return renderInlineChildren(node);
  }

  if (BLOCK_CONTAINER_TYPES.has(type)) {
    return renderChildren(node);
  }

  if (type === "list") {
    return renderList(node);
  }

  if (IGNORED_TYPES.has(type)) {
    return "";
  }

  return renderLeafNode(node, type);
}

function renderChildren(node: MarkdownNode): string {
  return (node.children ?? [])
    .map((child) => renderNode(child))
    .filter((value) => value.trim().length > 0)
    .join("\n");
}

function renderInlineChildren(node: MarkdownNode): string {
  return (node.children ?? [])
    .map((child) => renderNode(child))
    .join("")
    .trim();
}

function renderList(node: MarkdownNode): string {
  return (node.children ?? [])
    .map((child) => {
      const content = renderNode(child).trim();

      return content ? `- ${content}` : "";
    })
    .filter(Boolean)
    .join("\n");
}

function renderCodeBlock(node: MarkdownNode): string {
  const code = (node.value ?? "").trim();

  if (!code) {
    return "";
  }

  return node.lang ? `Code block (${node.lang}):\n${code}` : `Code block:\n${code}`;
}

function normalizeWhitespace(content: string): string {
  return content
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter((line, index, lines) => line.length > 0 || lines[index - 1]?.length)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
