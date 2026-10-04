import { Gift } from "lucide-react";
import type { ProductCategory, StoreNavigationGroup } from "@bitocard/api-client/storefront";
import { categoryTheme, groupIcon } from "./theme";

/**
 * Category and menu-group icons, the same everywhere in the store: the icon an admin uploaded (Storefront > Categories)
 * when there is one, else the built-in icon. Uploaded icons sit on a white tile so any artwork shows on dark and
 * light backgrounds alike.
 */
function Uploaded({ src, className }: { src: string; className: string }) {
  return (
    <span className={`inline-grid shrink-0 place-items-center overflow-hidden rounded-md bg-white p-0.5 ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element -- icons uploaded by admins, served from the storage CDN */}
      <img src={src} alt="" className="size-full object-contain" loading="lazy" />
    </span>
  );
}

/** A category's icon. `ink` colours the built-in icon (it defaults to the category's own colour). */
export function CategoryIcon({ category, iconUrl, className = "size-5", ink }: { category: ProductCategory; iconUrl?: string | null; className?: string; ink?: string }) {
  if (iconUrl) return <Uploaded src={iconUrl} className={className} />;
  const theme = categoryTheme[category];
  const Icon = theme.icon;
  return <Icon className={`shrink-0 ${className} ${ink ?? theme.ink}`} aria-hidden="true" />;
}

/**
 * A menu group's icon: its own category's uploaded icon when it has one category, else the first uploaded icon among
 * its categories, else the group's built-in icon.
 */
export function GroupIcon({ group, className = "size-5", ink = "" }: { group: StoreNavigationGroup; className?: string; ink?: string }) {
  const uploaded = group.categories.find(category => category.icon_url)?.icon_url;
  if (uploaded) return <Uploaded src={uploaded} className={className} />;
  const Icon = groupIcon[group.key] ?? Gift;
  return <Icon className={`shrink-0 ${className} ${ink}`} aria-hidden="true" />;
}

/** Each category's uploaded icon and banner, from the menu (for pages that only know a category key). */
export function categoryArt(groups: StoreNavigationGroup[]) {
  const art = new Map<string, { icon: string | null; banner: string | null }>();
  for (const category of groups.flatMap(group => group.categories)) art.set(category.category, { icon: category.icon_url, banner: category.image_url });
  return art;
}
