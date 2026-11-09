import { currentCustomer } from "@/lib/session";
import { signInPath, udozoUrl } from "@/lib/site";

const needs = [
  { title: "Your identity check", body: "Udozo Verify confirms who you are. Every centre needs it." },
  { title: "A confirmed mobile number", body: "So Udozo and the people you serve can reach you." },
  { title: "The Connect Centre agreement", body: "Read what running a centre involves, then accept it." },
  { title: "Your market's deposit", body: "Paid from your UdozoPay wallet when you send your application. It comes back if you withdraw or are not approved." },
  { title: "An online review and a visit", body: "Udozo's team reads your application, then Udozo's staff or a trained agent visits your office." },
];

const what = [
  { title: "Receive items from sellers", body: "Sellers bring items they sold to your office, and you check each one in." },
  { title: "Keep them safe", body: "Items wait on your shelves until the buyer comes." },
  { title: "Hand them to buyers", body: "The buyer inspects the item and gives their code before you hand it over." },
  { title: "Earn from Connect fees and storage", body: "Centres earn a share of the Connect fee on the items they handle, and storage charges, as the agreement sets out." },
];

/** What a Udozo Connect Centre is, what applying needs, and Apply (after signing in with a Udozo account). */
export default async function Home() {
  const customer = await currentCustomer();
  const apply = customer ? "/apply" : signInPath("/apply");
  return (
    <>
      <section className="bg-navy-900 text-white">
        <div className="mx-auto max-w-5xl px-4 py-12 sm:py-16">
          <p className="text-sm font-semibold uppercase tracking-wide text-white/70">Udozo Connect</p>
          <h1 className="mt-2 max-w-2xl text-3xl font-extrabold leading-tight sm:text-4xl">Run a Udozo Connect Centre from your office</h1>
          <p className="mt-4 max-w-2xl text-lg text-white/85">
            A Connect Centre is an office that receives items from sellers and hands them to buyers against their code. It is part of Udozo Connect, with
            UdozoPay, which holds the buyer&apos;s money until they have the item.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <a href={apply} className="inline-flex min-h-12 items-center rounded-xl bg-white px-6 font-semibold text-navy-900 hover:bg-slate-100">
              Apply
            </a>
            {customer ? (
              <a href="/application" className="inline-flex min-h-12 items-center rounded-xl border border-white/40 px-6 font-semibold text-white hover:bg-white/10">
                My application
              </a>
            ) : null}
          </div>
          {!customer ? <p className="mt-3 text-sm text-white/75">You sign in with your Udozo account on udozo.com.</p> : null}
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-4 py-10">
        <h2 className="text-2xl font-extrabold text-navy-900">What a centre does</h2>
        <ul className="mt-5 grid gap-4 sm:grid-cols-2">
          {what.map(item => (
            <li key={item.title} className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
              <h3 className="font-bold text-navy-900">{item.title}</h3>
              <p className="mt-1 text-slate-600">{item.body}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="mx-auto max-w-5xl px-4 pb-4">
        <h2 className="text-2xl font-extrabold text-navy-900">What applying needs</h2>
        <ol className="mt-5 grid gap-3">
          {needs.map((item, index) => (
            <li key={item.title} className="flex gap-3 rounded-2xl border border-slate-100 bg-white p-4">
              <span className="grid size-8 shrink-0 place-items-center rounded-full bg-navy-100 font-bold text-navy-900" aria-hidden="true">
                {index + 1}
              </span>
              <span className="min-w-0">
                <strong className="block text-navy-900">{item.title}</strong>
                <span className="text-slate-600">{item.body}</span>
              </span>
            </li>
          ))}
        </ol>
        <p className="mt-5 text-slate-600">
          You also give your business&apos;s details, the office&apos;s address, opening hours and capacity, the person in charge, and photos of the shopfront, the
          counter and where items are kept.{" "}
          <a href={udozoUrl("/legal/connect-centres")} className="font-semibold text-brand-600 hover:underline">
            Read the Connect Centre agreement
          </a>
          .
        </p>
        <a href={apply} className="mt-6 inline-flex min-h-12 items-center rounded-xl bg-navy-900 px-6 font-semibold text-white hover:bg-navy-800">
          Apply to run a centre
        </a>
      </section>
    </>
  );
}
