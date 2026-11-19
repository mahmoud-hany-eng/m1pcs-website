export default function AdminLoading() {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-background" role="status" aria-live="polite">
      <p className="text-sm text-text-secondary">Loading…</p>
    </div>
  );
}
