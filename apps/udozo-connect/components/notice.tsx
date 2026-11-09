/** A page that only says something, with a way back. */
export function Notice({ title, body, action }: { title: string; body: React.ReactNode; action?: { href: string; label: string } }) {
  return (
    <div className="mx-auto max-w-xl px-4 py-12">
      <section className="rounded-3xl border border-slate-100 bg-white p-6 shadow-sm sm:p-8">
        <h1 className="text-2xl font-extrabold text-navy-900">{title}</h1>
        <div className="mt-2 text-slate-600">{body}</div>
        <a href={action?.href ?? "/"} className="mt-5 inline-flex min-h-11 items-center rounded-xl bg-navy-900 px-5 font-semibold text-white hover:bg-navy-800">
          {action?.label ?? "Back to Udozo Connect"}
        </a>
      </section>
    </div>
  );
}
