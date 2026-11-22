// Test stand-in for `next/link` (which needs a running Next.js router): the same element a link renders.
import { createElement } from "react";

export default function Link({ href, children, prefetch, replace, scroll, ...rest }) {
  void prefetch;
  void replace;
  void scroll;
  return createElement("a", { href: typeof href === "string" ? href : (href?.pathname ?? ""), ...rest }, children);
}
