import Link from "next/link";
import { Fragment } from "react";

const LINK = /\[([^\]]+)\]\((\/[^)\s]*)\)/g;

/**
 * Renders plain text with `[label](/internal-path)` links as next/link anchors
 * (standard <a href>, so every link is crawlable). Only site-relative links are
 * recognised; anything else is left as literal text.
 */
export function InlineText({ text }: { text: string }) {
  const parts: React.ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  LINK.lastIndex = 0;
  while ((match = LINK.exec(text))) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    parts.push(
      <Link key={match.index} href={match[2]} className="font-medium text-accent underline underline-offset-2 hover:text-accent-hover">
        {match[1]}
      </Link>
    );
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return (
    <>
      {parts.map((p, i) => (
        <Fragment key={i}>{p}</Fragment>
      ))}
    </>
  );
}
