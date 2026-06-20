import type { ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { ClipboardActionButton } from "@/components/ui/clipboard-action-button";
import { cn } from "@/lib/ui/utils";

export function ChatMessageContent({ content }: { content: string }) {
  return (
    <div className="space-y-3">
      <ReactMarkdown
        components={markdownComponents}
        remarkPlugins={[remarkGfm]}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

const markdownComponents = {
  a({ children, href }) {
    return (
      <a
        href={href}
        rel="noreferrer"
        target="_blank"
        className="text-[rgb(var(--theme-color-rgb))] underline decoration-white/18 underline-offset-4 transition hover:text-white"
      >
        {children}
      </a>
    );
  },
  blockquote({ children }) {
    return (
      <blockquote className="border-l-2 border-white/18 pl-4 text-white/62">
        {children}
      </blockquote>
    );
  },
  code({ children }) {
    return (
      <code className="rounded-md bg-white/8 px-1.5 py-0.5 font-mono text-[0.88em] text-white/88">
        {children}
      </code>
    );
  },
  h1({ children }) {
    return (
      <h1 className="text-[1.08rem] font-semibold leading-7 text-white/92">
        {children}
      </h1>
    );
  },
  h2({ children }) {
    return (
      <h2 className="text-[1.04rem] font-semibold leading-7 text-white/90">
        {children}
      </h2>
    );
  },
  h3({ children }) {
    return (
      <h3 className="text-[1rem] font-semibold leading-7 text-white/88">
        {children}
      </h3>
    );
  },
  li({ children }) {
    return <li className="pl-1">{children}</li>;
  },
  ol({ children }) {
    return (
      <ol className="list-decimal space-y-1.5 pl-5 text-white/82">
        {children}
      </ol>
    );
  },
  p({ children }) {
    return <p className="whitespace-pre-wrap">{children}</p>;
  },
  pre({ children, node }) {
    return <MarkdownCodeBlock fallback={children} node={node} />;
  },
  strong({ children }) {
    return <strong className="font-semibold text-white/92">{children}</strong>;
  },
  table({ children }) {
    return (
      <div className="overflow-x-auto rounded-lg border border-white/10">
        <table className="min-w-full border-collapse text-left text-[0.88rem]">
          {children}
        </table>
      </div>
    );
  },
  tbody({ children }) {
    return <tbody className="divide-y divide-white/8">{children}</tbody>;
  },
  td({ children }) {
    return <td className="px-3 py-2 text-white/74">{children}</td>;
  },
  th({ children }) {
    return (
      <th className="bg-white/[0.045] px-3 py-2 font-semibold text-white/82">
        {children}
      </th>
    );
  },
  thead({ children }) {
    return <thead className="border-b border-white/10">{children}</thead>;
  },
  ul({ children }) {
    return (
      <ul className="list-disc space-y-1.5 pl-5 text-white/82">
        {children}
      </ul>
    );
  },
} satisfies Components;

function MarkdownCodeBlock({
  fallback,
  node,
}: {
  fallback: ReactNode;
  node?: HastNode;
}) {
  const code = extractCodeBlock(node);

  if (!code) {
    return (
      <pre className="overflow-x-auto rounded-lg bg-[#070a0f] px-3.5 py-3 font-mono text-[0.84rem] leading-6 text-white/78">
        {fallback}
      </pre>
    );
  }

  return (
    <figure className="overflow-hidden rounded-lg border border-[#1f2937] bg-[#070a0f] shadow-[0_14px_34px_rgba(0,0,0,0.24)]">
      <figcaption className="flex h-9 items-center justify-between border-b border-[#1f2937] bg-[#10151c] px-3">
        <span className="min-w-0 truncate text-[0.72rem] font-semibold uppercase tracking-[0.08em] text-slate-400">
          {code.language ?? "code"}
        </span>
        <ClipboardActionButton
          action="copy"
          value={code.value}
          aria-label="Copy code"
          className="size-6 text-slate-400 hover:bg-slate-700/70 hover:text-white focus-visible:bg-slate-700/70 focus-visible:text-white"
          iconClassName="size-3"
        />
      </figcaption>
      <pre
        className={cn(
          "max-w-full overflow-x-auto px-3.5 py-3 font-mono text-[0.84rem] leading-6 text-slate-100",
          "[tab-size:2] scrollbar-thin scrollbar-track-transparent scrollbar-thumb-slate-700",
        )}
      >
        <code>{code.value}</code>
      </pre>
    </figure>
  );
}

type HastNode = {
  children?: HastNode[];
  properties?: Record<string, unknown>;
  tagName?: string;
  type?: string;
  value?: unknown;
};

function extractCodeBlock(node: HastNode | undefined) {
  const codeNode = node?.children?.find((child) => child.tagName === "code");

  if (!codeNode) {
    return null;
  }

  const language = extractCodeLanguage(codeNode.properties?.className);
  const value = hastText(codeNode).replace(/\n$/u, "");

  return { language, value };
}

function extractCodeLanguage(className: unknown) {
  const classNames = Array.isArray(className)
    ? className
    : typeof className === "string"
      ? className.split(/\s+/u)
      : [];
  const languageClass = classNames.find((item) =>
    typeof item === "string" && item.startsWith("language-")
  );

  return typeof languageClass === "string"
    ? languageClass.replace(/^language-/u, "") || null
    : null;
}

function hastText(node: HastNode | undefined): string {
  if (!node) {
    return "";
  }

  if (node.type === "text") {
    return typeof node.value === "string" || typeof node.value === "number"
      ? String(node.value)
      : "";
  }

  return node.children?.map(hastText).join("") ?? "";
}
