/**
 * A PDF receipt's file, for staff with payments.read. GET only.
 *
 * Anyone else gets the same plain "not found" as for an address that does not exist (a customer must not be able to tell the admin area is
 * there), the middleware keeps the answer out of every cache and out of search results, and the headers stop the browser guessing a type.
 * `?download=1` asks the browser to save the file; otherwise it opens in the browser's own PDF viewer.
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

const notFound = () => new Response("Not found", { status: 404, headers: { ...PRIVATE_HEADERS, "Content-Type": "text/plain; charset=utf-8" } });

export async function GET(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await context.params;
  if (!isUuid(id)) return notFound();
  const state = await getStaffState();
  if (state.state === "unavailable") return new Response("The staff service is not available right now.", { status: 503, headers: { ...PRIVATE_HEADERS, "Content-Type": "text/plain; charset=utf-8" } });
  if (state.state !== "ok" || !state.permissions.has("payments.read")) return notFound();
  try {
    const file = await state.api.getOrderReceipt(id);
    const bytes = Buffer.from(file.content_base64, "base64");
    const download = new URL(request.url).searchParams.get("download") === "1";
    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: {
        ...PRIVATE_HEADERS,
        "Content-Type": "application/pdf",
        "Content-Length": String(bytes.length),
        "Content-Disposition": contentDispositionFor(file.file_name, download),
      },
    });
  } catch (error) {
    if (error instanceof StaffOperationError || error instanceof StaffPermissionError) return notFound();
    if (error instanceof StaffUnavailableError) return new Response("The staff service is not available right now.", { status: 503, headers: { ...PRIVATE_HEADERS, "Content-Type": "text/plain; charset=utf-8" } });
    return new Response("Something went wrong.", { status: 500, headers: { ...PRIVATE_HEADERS, "Content-Type": "text/plain; charset=utf-8" } });
  }
}
