/** Up to two initials from a name ("Obiageli Agu" → "OA"). */
export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0]!.toUpperCase())
    .join("");

/** Who is signed in: their initials in a pink circle, their name and email. */
export function ProfileCard({ name, email }: { name: string; email: string }) {
  return (
    <section aria-label="You" className="flex items-center gap-4 rounded-3xl bg-white p-5 ring-1 ring-slate-200/70">
      <span aria-hidden="true" className="grid size-16 shrink-0 place-items-center rounded-full bg-pink-50 text-xl font-extrabold text-brand-500">
        {initials(name) || "?"}
      </span>
      <div className="min-w-0">
        <p className="truncate text-xl font-extrabold text-navy-900">{name}</p>
        <p className="truncate text-slate-500">{email}</p>
      </div>
    </section>
  );
}
