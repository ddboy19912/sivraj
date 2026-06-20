import { useEffect, useState } from "react";

type TypingTextProps = {
  text: string;
  className?: string;
  intervalMs?: number;
};

/**
 * Progressively reveals live assistant text while a model response is actively
 * streaming. Use this only for the current streaming message; completed chat
 * history should render plain text immediately so remounts do not replay the
 * typing animation. The component keeps the already-revealed prefix when `text`
 * grows, which makes it compatible with token deltas without restarting.
 */
export function TypingText({
  text,
  className,
  intervalMs = 14,
}: TypingTextProps) {
  const [visibleLength, setVisibleLength] = useState(0);
  const renderedLength = Math.min(visibleLength, text.length);

  useEffect(() => {
    if (prefersReducedMotion()) {
      const timer = window.setTimeout(() => setVisibleLength(text.length), 0);
      return () => window.clearTimeout(timer);
    }

    const timer = window.setInterval(() => {
      setVisibleLength((current) => {
        if (current >= text.length) {
          window.clearInterval(timer);
          return current;
        }

        return current + 1;
      });
    }, intervalMs);

    return () => window.clearInterval(timer);
  }, [intervalMs, text]);

  return (
    <span aria-label={text} className={className}>
      <span aria-hidden="true">{text.slice(0, renderedLength)}</span>
    </span>
  );
}

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
