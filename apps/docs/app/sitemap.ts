import type { MetadataRoute } from "next";
import { siteUrl } from "@bitocard/ui/site";
import { guides } from "@/lib/guides";
import { eventSlug, tagSlug, tags, webhookEvents } from "@/lib/openapi";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteUrl(3002);
  const page = (path: string, priority: number) => ({ url: new URL(path, base).href, changeFrequency: "weekly" as const, priority });
  return [
    page("/", 1),
    page("/reference", 0.9),
    ...guides.map(guide => page(`/guides/${guide.slug}`, guide.slug === "quickstart" ? 0.9 : 0.7)),
    ...tags.map(tag => page(`/reference/${tagSlug(tag)}`, 0.8)),
    page("/reference/webhook-events", 0.7),
    ...webhookEvents.map(event => page(`/reference/webhook-events/${eventSlug(event.type)}`, 0.5)),
  ];
}
