"use client";

/**
 * The account forms. They post to server actions and show what comes back. They hold no session, no Supabase client
 * and no customer id: the browser sends only what the person typed, and the server decides everything else.
 */
import Link from "next/link";
import { useActionState, useEffect, useState, type ReactNode } from "react";
import { AFTER_SUCCESS_PATH, idleState, type FormState } from "@/lib/accounts/shared/form-state";
import {
  claimAction,
  createProfileAction,
  requestPasswordResetAction,
  resendConfirmationAction,
  signInAction,
  signUpAction,
  updatePasswordAction,
  updateProfileAction,
} from "@/lib/accounts/server/actions";
import { PASSWORD_MIN_LENGTH } from "@/lib/accounts/shared/validation";
import { FieldWrapper } from "@/components/forms/FieldWrapper";
import { TextArea } from "@/components/forms/TextArea";
import { TextInput } from "@/components/forms/TextInput";
import { Notice } from "./ui";

/**
 * Follows the server's choice of destination after a successful submit. Only the fixed destinations can be reached.
 *
 * It loads the page afresh instead of navigating inside the app. This happens once in an account's life (creating the
 * profile, or linking earlier orders) and the whole dashboard changes shape when it does (the navigation, the data,
 * the notice), so a clean load is the dependable choice. In the browser tests Next 15.5's in-app navigation right
 * after a server action sometimes did not complete, which left the old form on screen although the change had been made.
 */
function useFollowRedirect(state: FormState) {
  const target = state.status === "success" && state.then ? AFTER_SUCCESS_PATH[state.then] : null;
  useEffect(() => {
    if (target) window.location.assign(target);
  }, [target]);
}

function Feedback({ state }: { state: FormState }) {
  if (state.status === "error" && state.message) return <Notice tone="error">{state.message}</Notice>;
  if (state.status === "success") return <Notice tone="success">{state.message}</Notice>;
  return null;
}

function errorOf(state: FormState, field: string): string | undefined {
  return state.status === "error" ? state.fieldErrors?.[field] : undefined;
}

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="text-xs text-error">
      {message}
    </p>
  );
}

function Submit({ pending, children, pendingLabel = "Please wait…" }: { pending: boolean; children: ReactNode; pendingLabel?: string }) {
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className="btn-sheen btn-red inline-flex w-full items-center justify-center rounded-full px-6 py-3.5 text-base font-semibold disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? pendingLabel : children}
    </button>
  );
}

export function SignInForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(signInAction, idleState);
  // Controlled, so the address survives an error: React clears an uncontrolled form after every submit.
  const [email, setEmail] = useState("");
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <input type="hidden" name="next" value={next} />
      <Feedback state={state} />
      <FieldWrapper label="Email" htmlFor="signin-email" required>
        <TextInput id="signin-email" name="email" value={email} onChange={(e) => setEmail(e.target.value)} type="email" autoComplete="email" inputMode="email" required aria-invalid={Boolean(errorOf(state, "email"))} aria-describedby="signin-email-error" />
        <FieldError id="signin-email-error" message={errorOf(state, "email")} />
      </FieldWrapper>
      <FieldWrapper label="Password" htmlFor="signin-password" required>
        <TextInput id="signin-password" name="password" type="password" autoComplete="current-password" required aria-invalid={Boolean(errorOf(state, "password"))} aria-describedby="signin-password-error" />
        <FieldError id="signin-password-error" message={errorOf(state, "password")} />
      </FieldWrapper>
      <Submit pending={pending} pendingLabel="Logging in…">
        Log in
      </Submit>
    </form>
  );
}

export function ForgotPasswordForm() {
  const [state, action, pending] = useActionState(requestPasswordResetAction, idleState);
  // Controlled, so the address survives an error: React clears an uncontrolled form after every submit.
  const [email, setEmail] = useState("");
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <Feedback state={state} />
      <FieldWrapper label="Email" htmlFor="forgot-email" required hint="We will email you a link to choose a new password.">
        <TextInput id="forgot-email" name="email" value={email} onChange={(e) => setEmail(e.target.value)} type="email" autoComplete="email" inputMode="email" required aria-invalid={Boolean(errorOf(state, "email"))} aria-describedby="forgot-email-error" />
        <FieldError id="forgot-email-error" message={errorOf(state, "email")} />
      </FieldWrapper>
      <Submit pending={pending} pendingLabel="Sending…">
        Email me a reset link
      </Submit>
    </form>
  );
}

export function ResetPasswordForm() {
  const [state, action, pending] = useActionState(updatePasswordAction, idleState);
  useFollowRedirect(state);
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <Feedback state={state} />
      <FieldWrapper label="New password" htmlFor="reset-password" required hint={`At least ${PASSWORD_MIN_LENGTH} characters.`}>
        <TextInput id="reset-password" name="password" type="password" autoComplete="new-password" minLength={PASSWORD_MIN_LENGTH} required aria-invalid={Boolean(errorOf(state, "password"))} aria-describedby="reset-password-error" />
        <FieldError id="reset-password-error" message={errorOf(state, "password")} />
      </FieldWrapper>
      <FieldWrapper label="Type it again" htmlFor="reset-confirm" required>
        <TextInput id="reset-confirm" name="confirm" type="password" autoComplete="new-password" required aria-invalid={Boolean(errorOf(state, "confirm"))} aria-describedby="reset-confirm-error" />
        <FieldError id="reset-confirm-error" message={errorOf(state, "confirm")} />
      </FieldWrapper>
      <Submit pending={pending} pendingLabel="Saving…">
        Change password
      </Submit>
    </form>
  );
}

export function SignUpForm() {
  const [state, action, pending] = useActionState(signUpAction, idleState);
  // Controlled, so the address survives an error: React clears an uncontrolled form after every submit.
  const [email, setEmail] = useState("");
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <Feedback state={state} />
      <FieldWrapper label="Email" htmlFor="signup-email" required>
        <TextInput id="signup-email" name="email" value={email} onChange={(e) => setEmail(e.target.value)} type="email" autoComplete="email" inputMode="email" required aria-invalid={Boolean(errorOf(state, "email"))} aria-describedby="signup-email-error" />
        <FieldError id="signup-email-error" message={errorOf(state, "email")} />
      </FieldWrapper>
      <FieldWrapper label="Password" htmlFor="signup-password" required hint={`At least ${PASSWORD_MIN_LENGTH} characters.`}>
        <TextInput id="signup-password" name="password" type="password" autoComplete="new-password" minLength={PASSWORD_MIN_LENGTH} required aria-invalid={Boolean(errorOf(state, "password"))} aria-describedby="signup-password-error" />
        <FieldError id="signup-password-error" message={errorOf(state, "password")} />
      </FieldWrapper>
      <Submit pending={pending} pendingLabel="Creating your account…">
        Create account
      </Submit>
    </form>
  );
}

export function ResendForm() {
  const [state, action, pending] = useActionState(resendConfirmationAction, idleState);
  // Controlled, so the address survives an error: React clears an uncontrolled form after every submit.
  const [email, setEmail] = useState("");
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <Feedback state={state} />
      <FieldWrapper label="Email" htmlFor="resend-email">
        <TextInput id="resend-email" name="email" value={email} onChange={(e) => setEmail(e.target.value)} type="email" autoComplete="email" inputMode="email" required aria-invalid={Boolean(errorOf(state, "email"))} aria-describedby="resend-email-error" />
        <FieldError id="resend-email-error" message={errorOf(state, "email")} />
      </FieldWrapper>
      <button type="submit" disabled={pending} aria-busy={pending} className="btn-sheen btn-glass inline-flex w-full items-center justify-center rounded-full px-6 py-3 text-sm font-semibold disabled:opacity-60">
        {pending ? "Sending…" : "Send the link again"}
      </button>
    </form>
  );
}

export interface ProfileDefaults {
  full_name: string;
  phone: string | null;
  preferred_language: "en" | "ar";
  delivery_address: string | null;
  marketing_consent: boolean;
}

export function ProfileForm({ mode, defaults }: { mode: "create" | "update"; defaults?: ProfileDefaults }) {
  const [state, action, pending] = useActionState(mode === "create" ? createProfileAction : updateProfileAction, idleState);
  useFollowRedirect(state);
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <Feedback state={state} />
      <FieldWrapper label="Full name" htmlFor="profile-name" required>
        <TextInput id="profile-name" name="full_name" autoComplete="name" defaultValue={defaults?.full_name ?? ""} required maxLength={120} aria-invalid={Boolean(errorOf(state, "full_name"))} aria-describedby="profile-name-error" />
        <FieldError id="profile-name-error" message={errorOf(state, "full_name")} />
      </FieldWrapper>
      <FieldWrapper label="Mobile / WhatsApp" htmlFor="profile-phone" hint="Optional. Helps M1 match you to your WhatsApp orders. It is never used to link your account on its own.">
        <TextInput id="profile-phone" name="phone" type="tel" autoComplete="tel" inputMode="tel" defaultValue={defaults?.phone ?? ""} aria-invalid={Boolean(errorOf(state, "phone"))} aria-describedby="profile-phone-error" />
        <FieldError id="profile-phone-error" message={errorOf(state, "phone")} />
      </FieldWrapper>
      <FieldWrapper label="Preferred language" htmlFor="profile-language">
        <select id="profile-language" name="preferred_language" defaultValue={defaults?.preferred_language ?? "en"} className="glass-input min-h-[3.25rem] px-4 py-3 text-base">
          <option value="en">English</option>
          <option value="ar">العربية (Arabic)</option>
        </select>
        <FieldError id="profile-language-error" message={errorOf(state, "preferred_language")} />
      </FieldWrapper>
      {mode === "update" ? (
        <>
          <FieldWrapper label="Delivery address" htmlFor="profile-address" hint="Optional. Where M1 should deliver your orders.">
            <TextArea id="profile-address" name="delivery_address" rows={3} maxLength={500} defaultValue={defaults?.delivery_address ?? ""} />
            <FieldError id="profile-address-error" message={errorOf(state, "delivery_address")} />
          </FieldWrapper>
          <label className="flex items-start gap-3 text-sm text-text-secondary">
            <input type="checkbox" name="marketing_consent" defaultChecked={defaults?.marketing_consent ?? false} className="mt-1 h-4 w-4 accent-[rgb(231_50_37)]" />
            <span>I am happy for M1 to message me about new builds and offers. I can change this at any time.</span>
          </label>
        </>
      ) : (
        <input type="hidden" name="delivery_address" value="" />
      )}
      <Submit pending={pending} pendingLabel="Saving…">
        {mode === "create" ? "Create my profile" : "Save changes"}
      </Submit>
    </form>
  );
}

export function ClaimForm() {
  const [state, action, pending] = useActionState(claimAction, idleState);
  useFollowRedirect(state);
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <Feedback state={state} />
      <FieldWrapper label="Claim code" htmlFor="claim-code" required hint="The code M1 sent you, like ABCDE-12345-FGHIJ-67890. It works once and expires.">
        <TextInput
          id="claim-code"
          name="code"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={64}
          required
          className="font-mono tracking-widest"
          placeholder="XXXXX-XXXXX-XXXXX-XXXXX"
        />
      </FieldWrapper>
      <Submit pending={pending} pendingLabel="Checking…">
        Link my orders
      </Submit>
      <p className="text-xs text-text-muted">
        No code yet? Message M1 on WhatsApp and we will send you one. You can also{" "}
        <Link href="/account" className="text-accent underline-offset-2 hover:underline">
          start with a new profile
        </Link>
        , but an account that starts with a new profile cannot be linked to an older one later.
      </p>
    </form>
  );
}
