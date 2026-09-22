// Server component: this only builds a static href from plain data — no
// hooks or browser APIs — so it renders on the server with zero client JS.
import { buildGeneralContactMessage, buildWhatsAppLink } from "@/lib/whatsapp";

/**
 * Fixed-position WhatsApp launcher. Positioned to stay clear of the sticky
 * header and any bottom content, and to never obscure form fields (extra
 * bottom padding is added on the quote form page instead of hiding this
 * button there).
 */
export function WhatsAppFloatingButton() {
  const href = buildWhatsAppLink(buildGeneralContactMessage());

  // No WhatsApp number configured — don't render a broken/empty link.
  if (!href) return null;

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Chat with M1 on WhatsApp"
      className="fixed bottom-5 right-5 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-[#25D366] text-black shadow-lg shadow-black/40 transition-transform hover:scale-105 active:scale-95 sm:bottom-6 sm:right-6"
    >
      <svg
        viewBox="0 0 32 32"
        aria-hidden="true"
        className="h-7 w-7"
        fill="currentColor"
      >
        <path d="M16.004 3C9.377 3 4 8.373 4 15c0 2.34.66 4.523 1.807 6.383L4 29l7.81-1.767A11.94 11.94 0 0 0 16.004 27C22.63 27 28 21.627 28 15S22.63 3 16.004 3Zm0 21.75c-1.98 0-3.85-.55-5.44-1.51l-.39-.23-4.63 1.05 1.08-4.5-.25-.42A9.71 9.71 0 0 1 5.25 15c0-5.93 4.82-10.75 10.754-10.75S26.75 9.07 26.75 15 21.938 24.75 16.004 24.75Zm5.87-7.98c-.32-.16-1.9-.94-2.2-1.05-.29-.11-.51-.16-.72.16-.21.32-.83 1.05-1.02 1.26-.19.21-.37.24-.69.08-.32-.16-1.35-.5-2.57-1.58-.95-.85-1.59-1.9-1.78-2.22-.19-.32-.02-.49.14-.65.14-.14.32-.37.48-.55.16-.19.21-.32.32-.53.11-.21.05-.4-.03-.56-.08-.16-.72-1.74-.99-2.38-.26-.63-.53-.54-.72-.55-.19-.01-.4-.01-.61-.01-.21 0-.56.08-.85.4-.29.32-1.12 1.09-1.12 2.67s1.15 3.1 1.31 3.31c.16.21 2.26 3.45 5.48 4.84.77.33 1.37.53 1.84.68.77.24 1.47.21 2.02.13.62-.09 1.9-.78 2.17-1.53.27-.75.27-1.39.19-1.53-.08-.13-.29-.21-.61-.37Z" />
      </svg>
    </a>
  );
}
