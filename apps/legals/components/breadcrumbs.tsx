import Link from "next/link";

export function Breadcrumbs({ trail, current }: { trail: { href: string; label: string }[]; current: string }) {
  return (
    <nav className="breadcrumbs" aria-label="Breadcrumb">
      <ol>
        {trail.map(item => <li key={item.href}><Link href={item.href}>{item.label}</Link></li>)}
        <li aria-current="page">{current}</li>
      </ol>
    </nav>
  );
}
