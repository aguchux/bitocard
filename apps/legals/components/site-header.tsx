"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState, type FocusEvent } from "react";
import { BrandLockup } from "@bitocard/ui/brand-lockup";
import { legalDocuments } from "@bitocard/ui/legal";
import { documentDetails } from "@/components/content";
import { Icon } from "@/components/icons";

/** Header with Home, a Documents dropdown (disclosure pattern) and Contact. */
export function SiteHeader() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const inDocuments = pathname.startsWith("/documents");

  // While open, close on Escape (returning focus to the button) or a click outside.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  // Close when keyboard focus moves out of the dropdown.
  const onBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  };
  const close = () => setOpen(false);

  return (
    <header className="site-header">
      <BrandLockup tagline="Legals & Compliance" />
      <nav aria-label="Main">
        <Link href="/" aria-current={pathname === "/" ? "page" : undefined}>Home</Link>
        <div className="menu" ref={wrapper} onBlur={onBlur}>
          <button
            ref={button}
            type="button"
            className="menu-button"
            aria-expanded={open}
            aria-controls={panelId}
            data-current={inDocuments || undefined}
            onClick={() => setOpen(value => !value)}
          >
            Documents <span className="menu-caret" aria-hidden="true" />
          </button>
          <div id={panelId} className="menu-panel" hidden={!open}>
            <Link className="menu-all" href="/documents" onClick={close} aria-current={pathname === "/documents" ? "page" : undefined}>
              All documents <span aria-hidden="true">→</span>
            </Link>
            <ul>
              {legalDocuments.map(doc => (
                <li key={doc.href}>
                  <Link className="menu-item" href={doc.href} onClick={close} aria-current={pathname === doc.href ? "page" : undefined}>
                    <span className="menu-icon"><Icon name={documentDetails[doc.href].icon} /></span>
                    <span className="menu-text"><strong>{doc.label}</strong><span>{documentDetails[doc.href].summary}</span></span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <Link href="/contact" aria-current={pathname.startsWith("/contact") ? "page" : undefined}>Contact</Link>
      </nav>
    </header>
  );
}
