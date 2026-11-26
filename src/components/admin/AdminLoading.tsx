/**
 * What an admin page shows while the server is still preparing it (the `loading.tsx` of the admin area).
 *
 * It is the same frame as `AdminShell` (the sticky side column, the M1 mark, the side navigation, the title area) drawn with plain
 * placeholder blocks, inside the ordinary site with the public header on top, so that moving between sections does not make the page
 * jump when the real one arrives. It is STATIC on purpose: no animation, no data, no link, no staff name, no permission. The real navigation
 * and everything the person is allowed to see come with the real page, after the server has verified them.
 *
 * It is only ever sent after the admin layout has accepted the request (see `layout.tsx`): a person who is not staff gets
 * the site's ordinary 404 before anything is streamed, so this placeholder never reveals that an admin area exists.
 */
const NAV_PLACEHOLDERS = [
  "w-24", "w-28", "w-24", "w-28", "w-24", "w-28", "w-24",
] as const;

const block = "block rounded-md bg-white/[0.07]";

export function AdminLoading() {
  return (
    <div className="admin-root text-text-primary" aria-busy="true">
      <p role="status" className="sr-only">
        Loading
      </p>
      <div className="mx-auto flex w-full max-w-[96rem] flex-col lg:flex-row">
        <aside className="lg:sticky lg:top-20 lg:h-[calc(100dvh-5rem)] lg:w-64 lg:shrink-0 lg:self-start lg:overflow-y-auto lg:border-r lg:border-border">
          <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 lg:flex-col lg:items-stretch lg:gap-6 lg:border-b-0 lg:px-5 lg:py-6">
            <div className="flex items-center gap-2.5" aria-hidden="true">
              <span className="btn-red flex h-9 w-9 items-center justify-center rounded-xl font-display text-sm font-bold text-white">M1</span>
              <span className="flex flex-col leading-tight">
                <span className="font-display text-sm font-bold tracking-tight text-white">M1 Staff</span>
                <span className="text-[11px] uppercase tracking-[0.18em] text-text-muted">Dashboard</span>
              </span>
            </div>
          </div>
          <div aria-hidden="true" className="scrollbar-hide flex gap-1.5 overflow-x-auto px-4 py-3 lg:flex-col lg:gap-1 lg:overflow-visible lg:px-3 lg:py-2">
            {NAV_PLACEHOLDERS.map((width, index) => (
              <span key={index} className="flex shrink-0 items-center gap-2.5 rounded-full border border-border-strong px-4 py-2.5 lg:rounded-xl lg:border-transparent lg:px-3.5">
                <span className={`${block} h-[18px] w-[18px]`} />
                <span className={`${block} h-3 ${width}`} />
              </span>
            ))}
          </div>
        </aside>

        <div className="min-w-0 flex-1">
          <div className="px-4 pb-16 pt-6 sm:px-6 sm:pt-8 lg:px-10" aria-hidden="true">
            <div className="mb-6 flex flex-col gap-3">
              <span className={`${block} h-8 w-48 sm:h-9`} />
              <span className={`${block} h-3 w-full max-w-md`} />
            </div>
            <div className="flex flex-col gap-6">
              <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
                {[0, 1, 2, 3].map((tile) => (
                  <div key={tile} className="glass flex flex-col gap-3 p-4">
                    <span className={`${block} h-3 w-20`} />
                    <span className={`${block} h-7 w-16`} />
                  </div>
                ))}
              </div>
              <div className="glass flex flex-col gap-4 p-4 sm:p-5">
                <span className={`${block} h-4 w-40`} />
                {[0, 1, 2, 3, 4].map((row) => (
                  <span key={row} className={`${block} h-3 w-full`} />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
