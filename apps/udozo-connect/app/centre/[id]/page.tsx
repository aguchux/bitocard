import type { Metadata } from "next";
import { Panel, primary, secondary } from "@/components/centre-ui";
import { ResumeButton } from "@/components/centre-settings";
import { canManage, day, mapLink, pauseWords } from "@/lib/centres";
import { readCentre, readSummary } from "@/lib/centre-data";

export const metadata: Metadata = { title: "Your centre" };

/** The centre today: whether it takes orders, what it holds and is set up with, and what to set up next. */
export default async function CentreOverview({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [read, summary] = await Promise.all([readCentre(id), readSummary(id)]);
  if (!read.ok) return null;
  const centre = read.data;
  const stopped = pauseWords(centre, day);
  const manages = canManage(centre.role);
  const map = mapLink(centre);
  const figures = [
    { label: "Holds", value: `${centre.capacity} items` },
    { label: "Storage places", value: String(centre.shelves) },
    { label: "People", value: String(centre.people) },
  ];
  return (
    <div className="grid gap-5">
      {stopped ? (
        <Panel title={centre.status === "closed" ? "This centre is closed" : "Taking no new orders"} tone="warn">
          <p>{stopped}</p>
          {centre.status === "paused" && centre.paused?.by === "partner" && manages ? <ResumeButton id={centre.id} className="mt-3" /> : null}
        </Panel>
      ) : null}

      <dl className="grid grid-cols-3 gap-3">
        {figures.map(item => (
          <div key={item.label} className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm">
            <dt className="text-xs font-semibold text-slate-500 sm:text-sm">{item.label}</dt>
            <dd className="mt-1 text-xl font-extrabold text-navy-900 sm:text-2xl">{item.value}</dd>
          </div>
        ))}
      </dl>

      <Panel title="Today at your centre">
        {summary.ok ? (
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {[
              { label: "On their way", value: summary.data.expected, view: "expected" },
              { label: "To shelve", value: summary.data.to_shelve, view: "at_centre" },
              { label: "Ready to collect", value: summary.data.ready, view: "at_centre" },
              { label: "Due today", value: summary.data.due_today, view: "at_centre" },
              { label: "Overdue", value: summary.data.overdue, view: "at_centre" },
            ].map(item => (
              <li key={item.label}>
                <a href={`/centre/${centre.id}/orders?view=${item.view}`} className={`block rounded-xl border p-3 hover:border-navy-200 ${item.label === "Overdue" && item.value ? "border-amber-200 bg-amber-50" : "border-slate-100 bg-white"}`}>
                  <span className="block text-xs font-semibold text-slate-500">{item.label}</span>
                  <span className="block text-xl font-extrabold text-navy-900">{item.value}</span>
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <p>Items sellers send to your centre show under Items: what is on its way, what to receive and shelve, and what buyers are coming to collect.</p>
        )}
      </Panel>

      {centre.shelves === 0 || centre.people === 1 ? (
        <Panel title="Get ready">
          <ul className="grid gap-3">
            {centre.shelves === 0 ? (
              <li>
                <p>Set up your storage places (shelves, racks, a back room), so every item has a place and staff always know where it is.</p>
                {manages ? (
                  <a href={`/centre/${centre.id}/shelves`} className={`${primary} mt-2`}>
                    Set up storage places
                  </a>
                ) : null}
              </li>
            ) : null}
            {centre.people === 1 && centre.role === "owner" ? (
              <li>
                <p>Add the people who work at your counter, so they can sign in with their own Udozo accounts.</p>
                <a href={`/centre/${centre.id}/staff`} className={`${secondary} mt-2`}>
                  Add staff
                </a>
              </li>
            ) : null}
          </ul>
        </Panel>
      ) : null}

      <Panel title="Your office">
        <p className="text-navy-900">{centre.address}</p>
        {centre.landmark ? <p className="text-sm">{centre.landmark}</p> : null}
        <p className="mt-2 text-sm">
          {centre.hours} · <a href={`tel:${centre.phone.replace(/[^\d+]/g, "")}`} className="font-semibold text-brand-600 hover:underline">{centre.phone}</a>
        </p>
        <div className="mt-3 flex flex-wrap gap-3 text-sm">
          {map ? (
            <a href={map} target="_blank" rel="noopener noreferrer" className="font-semibold text-brand-600 hover:underline">
              See it on a map
            </a>
          ) : null}
          {manages ? (
            <a href={`/centre/${centre.id}/settings`} className="font-semibold text-brand-600 hover:underline">
              Change hours or phone
            </a>
          ) : null}
        </div>
      </Panel>
    </div>
  );
}
