import Link from "next/link";
import { Container } from "@/components/ui/Container";

/**
 * A page inside the account area that was not found, for example an order that does not exist. An order that belongs
 * to someone else lands here too, with exactly the same wording, so the page cannot be used to learn which order
 * references exist.
 */
export default function AccountNotFound() {
  return (
    <section>
      <Container className="flex justify-center pb-20 pt-16">
        <div className="glass glass-strong flex w-full max-w-lg flex-col items-center gap-4 p-8 text-center">
          <h1 className="font-display text-2xl font-bold text-white">We could not find that</h1>
          <p className="text-sm text-text-secondary">The page or order you asked for is not available on your account.</p>
          <Link href="/account/orders" className="btn-sheen btn-glass inline-flex items-center justify-center rounded-full px-6 py-3 text-sm font-semibold">
            Go to my orders
          </Link>
        </div>
      </Container>
    </section>
  );
}
