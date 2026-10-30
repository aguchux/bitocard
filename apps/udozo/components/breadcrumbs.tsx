import Link from "next/link";
import { ChevronRight } from "lucide-react";

/** Where a page sits: the country, then its category or place. The last item is this page. */
export function Breadcrumbs({ trail }: { trail: { name: string; path: string }[] }) {
  return (
    <nav aria-label="Breadcrumb" className="overflow-x-auto text-sm text-navy-600">
      <ol className="flex items-center gap-1 whitespace-nowrap">
        {trail.map((item, index) => (
          <li key={item.path} className="flex items-center gap-1">
            {index ? <ChevronRight className="size-3.5 text-navy-400" aria-hidden="true" /> : null}
            {index === trail.length - 1 ? (
              <span aria-current="page" className="font-semibold text-navy-900">
                {item.name}
              </span>
            ) : (
              <Link href={item.path} className="hover:underline">
                {item.name}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
