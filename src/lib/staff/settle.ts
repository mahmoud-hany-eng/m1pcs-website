/**
 * Runs one read and turns a refusal or an outage into a value, so a page can say "this part could not be loaded" and still show the rest.
 * Only the two expected failure kinds are caught: anything else (a bug) still reaches the error boundary.
 */
import { StaffOperationError, StaffUnavailableError } from "./gateway";

export type Settled<T> = { ok: true; value: T } | { ok: false; error: string };

export async function settle<T>(run: () => Promise<T>): Promise<Settled<T>> {
  try {
    return { ok: true, value: await run() };
  } catch (error) {
    if (error instanceof StaffOperationError || error instanceof StaffUnavailableError) return { ok: false, error: error.message };
    throw error;
  }
}
