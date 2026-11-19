import Link from "next/link";

export default function AdminNotFound() {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center overflow-y-auto bg-background p-6">
      <div className="glass glass-strong w-full max-w-md p-6 text-center">
        <h1 className="font-display text-xl font-bold text-white">That record was not found</h1>
        <p className="mt-2 text-sm text-text-secondary">It may have been removed, or you may not have access to it.</p>
        <Link href="/admin" className="btn-sheen btn-glass mt-5 inline-flex items-center justify-center rounded-full px-6 py-3 text-sm font-semibold">
          Back to the dashboard
        </Link>
      </div>
    </div>
  );
}
