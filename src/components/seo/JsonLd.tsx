/**
 * Renders one or more schema.org JSON-LD objects as a server-rendered
 * <script type="application/ld+json"> (so it is in the initial HTML, not
 * injected by client JS).
 *
 * `<` is escaped to < so a string value can never terminate the script
 * element early (the standard JSON-in-HTML hardening).
 */
export function JsonLd({ data }: { data: Record<string, unknown> | Record<string, unknown>[] }) {
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />;
}
