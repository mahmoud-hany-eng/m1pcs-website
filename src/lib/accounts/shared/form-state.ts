import type { FieldErrors } from "./validation";

/** What a form's server action hands back to the page. Messages are fixed text, never an echo of the input. */
export type FormState =
  | { status: "idle" }
  | { status: "error"; message?: string; fieldErrors?: FieldErrors }
  // `then` names one of a fixed set of destinations (never an address, and never taken from the form).
  | { status: "success"; message: string; then?: AfterSuccess };

export type AfterSuccess = "account" | "welcome" | "linked";

/** The only places a form may send someone after it succeeds. */
export const AFTER_SUCCESS_PATH: Record<AfterSuccess, string> = {
  account: "/account",
  welcome: "/account?welcome=1",
  linked: "/account?linked=1",
};

export const idleState: FormState = { status: "idle" };
