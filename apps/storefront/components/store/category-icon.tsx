import { Gift, type LucideIcon } from "lucide-react";
import type { ProductCategory, StoreNavigationGroup } from "@bitocard/api-client/storefront";
import { categoryTheme, groupIcon } from "./theme";

/**
 * Category and menu-group icons, the same everywhere in the store: the icon an admin uploaded (Storefront > Categories)
 * when there is one, else the built-in icon. `className` sets the tile's size (for example `size-8`); both kinds fill
 * the same tile, so an upload never shows smaller than the icon it replaces. Uploaded icons sit on white so any
 * artwork shows on the navy hero and on white pages alike. Use at least `size-6`: uploaded artwork is detailed.
 */
function Tile({ src, Icon, className, ink, tile }: { src?: string | null; Icon: LucideIcon; className: string; ink: string; tile: string }) {
  return (
    <span className={`relative inline-grid shrink-0 place-items-center overflow-hidden rounded-lg ${src ? "bg-white shadow-sm ring-1 ring-black/5" : tile} ${className}`}>
      {src ? (
        // Positioned against the tile itself: a percentage size inside a grid cell would collapse to nothing.
        // eslint-disable-next-line @next/next/no-img-element -- icons uploaded by admins, served from the storage CDN
        <img src={src} alt="" className="absolute inset-0 m-auto h-[80%] w-[80%] object-contain" loading="lazy" />
      ) : (
        <Icon className={`absolute inset-0 m-auto h-[62%] w-[62%] ${ink}`} aria-hidden="true" />
      )}
    </span>
  );
}

/** A category's icon. `ink` colours the built-in icon and `tile` its background (the category's own colours by default). */
export function CategoryIcon({ category, iconUrl, className = "size-8", ink, tile }: { category: ProductCategory; iconUrl?: string | null; className?: string; ink?: string; tile?: string }) {
  const theme = categoryTheme[category];
  return <Tile src={iconUrl} Icon={theme.icon} className={className} ink={ink ?? theme.ink} tile={tile ?? theme.tile} />;
}

/**
 * A menu group's icon: the first uploaded icon among its categories (its own, for a one-category group), else the
 * group's built-in icon.
 */
export function GroupIcon({ group, className = "size-8", ink = "text-[#e0116d]", tile = "bg-pink-50" }: { group: StoreNavigationGroup; className?: string; ink?: string; tile?: string }) {
  const uploaded = group.categories.find(category => category.icon_url)?.icon_url;
  return <Tile src={uploaded} Icon={groupIcon[group.key] ?? Gift} className={className} ink={ink} tile={tile} />;
}

/** Each category's uploaded icon and banner, from the menu (for pages that only know a category key). */
export function categoryArt(groups: StoreNavigationGroup[]) {
  const art = new Map<string, { icon: string | null; banner: string | null }>();
  for (const category of groups.flatMap(group => group.categories)) art.set(category.category, { icon: category.icon_url, banner: category.image_url });
  return art;
}
