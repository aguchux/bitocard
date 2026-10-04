import { ExternalLink } from 'lucide-react';
import { cn } from '../format';

/** Links to a provider's own pages (sign up, API keys, docs), opened in a new tab. Renders nothing without links. */
export function ExternalLinks({ links, className }: { links: Array<{ label: string; url: string }>; className?: string }) {
  if (links.length === 0) return null;
  return (
    <ul className={cn('flex flex-wrap gap-x-4 gap-y-1.5 text-sm', className)}>
      {links.map(link => (
        <li key={link.url}>
          <a href={link.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-brand-600 hover:underline">
            {link.label}
            <ExternalLink className="size-3.5" aria-hidden />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        </li>
      ))}
    </ul>
  );
}
