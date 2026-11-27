/**
 * A stored original of a historical order (a receipt or an invoice), for the owner only (import.manage). GET only.
 *
 * Anyone else gets the same plain "not found" as for an address that does not exist (a customer must not be able to tell the admin area is there),
 * the middleware keeps the answer out of every cache and out of search results, and the headers stop the browser guessing a type or running anything.
 * The file is served only as the type its CONTENT proved to be when it was stored (a PDF or a PNG), never as a type a request asks for, and
 * `?download=1` asks the browser to save it.
 */
import { isUuid } from "@/lib/staff/validation";
import { StaffOperationError, StaffPermissionError, StaffUnavailableError } from "@/lib/staff/gateway";
import { contentDispositionFor } from "@/lib/staff/receipts";
import { getStaffState } from "@/lib/staff/session";

const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow",
  "Referrer-Policy": "no-referrer",
  "Cross-Origin-Resource-Policy": "same-origin",
} as const;

const plain = (status: number, body: string) => new Response(body, { status, headers: { ...PRIVATE_HEADERS, "Content-Type": "text/plain; charset=utf-8" } });
const ALLOWED_TYPES = new Set(["application/pdf", "image/png"]);

export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await context.params;
  if (!isUuid(id)) return plain(404, "Not found");
  const state = await getStaffState();
  if (state.state === "unavailable") return plain(503, "The staff service is not available right now.");
  if (state.state !== "ok" || !state.permissions.has("import.manage")) return plain(404, "Not found");
  try {
    const file = await state.api.histGetAttachment(id);
    if (!ALLOWED_TYPES.has(file.mime)) return plain(404, "Not found");
    const bytes = Buffer.from(file.content_base64, "base64");
    const download = new URL(request.url).searchParams.get("download") === "1";
    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: {
        ...PRIVATE_HEADERS,
        "Content-Type": file.mime,
        "Content-Length": String(bytes.length),
        "Content-Disposition": contentDispositionFor(file.file_name, download),
      },
    });
  } catch (error) {
    if (error instanceof StaffOperationError || error instanceof StaffPermissionError) return plain(404, "Not found");
    if (error instanceof StaffUnavailableError) return plain(503, "The staff service is not available right now.");
    return plain(500, "Something went wrong.");
  }
}
