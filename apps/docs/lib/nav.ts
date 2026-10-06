import "server-only";
import { guides } from "./guides";
import { operationHref, operations, operationsFor, sections, tagSlug, tags, webhookEvents, eventSlug, tagIntros } from "./openapi";

export type NavLink = { title: string; href: string; method?: string };
export type NavGroup = { title: string; links: NavLink[]; collapsible?: boolean };

/** The sidebar: guides, then the API reference by section (each tag with its operations), then webhook events. */
export function navigation(): NavGroup[] {
  const guideGroups = [...new Set(guides.map(guide => guide.group))].map(group => ({
    title: group,
    links: guides.filter(guide => guide.group === group).map(guide => ({ title: guide.title, href: `/guides/${guide.slug}` })),
  }));
  const referenceGroups = sections
    .map(section => ({
      title: section.title,
      collapsible: true,
      links: section.tags
        .filter(tag => tags.includes(tag))
        .flatMap(tag => [{ title: tag, href: `/reference/${tagSlug(tag)}` }]),
    }))
    .filter(group => group.links.length);
  return [
    { title: "Overview", links: [{ title: "Introduction", href: "/" }, { title: "API reference", href: "/reference" }] },
    ...guideGroups,
    ...referenceGroups,
    { title: "Webhook events", collapsible: true, links: webhookEvents.map(event => ({ title: event.type, href: `/reference/webhook-events/${eventSlug(event.type)}` })) },
  ];
}

export type SearchEntry = { title: string; href: string; kind: "Guide" | "Section" | "Endpoint" | "Event"; detail: string; method?: string };

/** Everything searchable, built at build time and sent once to the search box. */
export async function searchIndex(): Promise<SearchEntry[]> {
  const { loadGuide } = await import("./guides");
  const guideEntries = await Promise.all(
    guides.map(async guide => {
      const loaded = await loadGuide(guide.slug);
      return [
        { title: guide.title, href: `/guides/${guide.slug}`, kind: "Guide" as const, detail: loaded?.description ?? "" },
        ...(loaded?.headings ?? [])
          .filter(heading => heading.depth <= 3)
          .map(heading => ({ title: heading.text, href: `/guides/${guide.slug}#${heading.id}`, kind: "Section" as const, detail: guide.title })),
      ];
    }),
  );
  return [
    ...guideEntries.flat(),
    ...tags.map(tag => ({ title: tag, href: `/reference/${tagSlug(tag)}`, kind: "Section" as const, detail: tagIntros[tag] ?? `${operationsFor(tag).length} endpoints` })),
    ...operations.map(operation => ({ title: operation.summary, href: operationHref(operation), kind: "Endpoint" as const, detail: operation.path, method: operation.method.toUpperCase() })),
    ...webhookEvents.map(event => ({ title: event.type, href: `/reference/webhook-events/${eventSlug(event.type)}`, kind: "Event" as const, detail: event.summary })),
  ];
}
