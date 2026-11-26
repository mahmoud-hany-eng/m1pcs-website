// Test stand-in for `next/server` (which Node cannot load without Next.js): the part of NextResponse the routes use, built on the platform's own Response.
export class NextResponse extends Response {
  static json(body, init = {}) {
    const headers = new Headers(init.headers ?? {});
    if (!headers.has("content-type")) headers.set("content-type", "application/json");
    return new NextResponse(JSON.stringify(body), { ...init, headers });
  }
  static redirect(url, init) {
    return new NextResponse(null, { status: typeof init === "number" ? init : (init?.status ?? 307), headers: { location: String(url) } });
  }
  static next() {
    return new NextResponse(null, { status: 200 });
  }
}
