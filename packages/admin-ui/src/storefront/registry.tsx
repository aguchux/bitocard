"use client";

import { createContext, useContext, type ComponentType } from "react";
import type { LucideIcon } from "lucide-react";
import type { StoreSection } from "@bitocard/api-client/storefront";
import { cleanForSave, type GridSection, newSection, sectionSummary, sectionTitle, sectionTypes } from "./grid";

/** What every section has, whatever page it is on: the editor's grid works on these alone. */
export type EditorSection = GridSection;

/**
 * The sections a home page editor offers and how it shows them: the "Add section" menu's list, a new section's
 * defaults, the canvas card's summary, title and icon, and the inspector's form. bitocard.com's and resellers' stores
 * use `storeRegistry` (the default); udozo.com's home pages bring their own, so neither changes the other.
 */
export type SectionRegistry<S extends EditorSection = EditorSection> = {
  types: ReadonlyArray<{ type: S["type"]; label: string; description: string }>;
  newSection(type: S["type"], id: string): S;
  summary(section: S): string;
  title(section: S): string;
  icon(type: S["type"]): LucideIcon;
  Form: ComponentType<{ section: S; onChange: (next: S) => void }>;
  /** The layout as sent to the API (for example, blank list items left out); as it is by default. */
  clean?(sections: S[]): S[];
};

/** A registry for any page's own section type, usable wherever the editor takes one. */
export const defineRegistry = <S extends EditorSection>(registry: SectionRegistry<S>) => registry as unknown as SectionRegistry;

export const registryLabel = (registry: SectionRegistry, type: string) => registry.types.find(item => item.type === type)?.label ?? type;

/** The editor's current registry (the stores' unless a page gives its own). */
const RegistryContext = createContext<SectionRegistry | null>(null);
export const SectionRegistryProvider = RegistryContext.Provider;

/** The store sections' registry: built lazily, so the canvas's icons and the forms load with the editor. */
export function makeStoreRegistry(icon: (type: StoreSection["type"]) => LucideIcon, Form: ComponentType<{ section: StoreSection; onChange: (next: StoreSection) => void }>) {
  return defineRegistry<StoreSection>({ types: sectionTypes, newSection, summary: sectionSummary, title: sectionTitle, icon, Form, clean: cleanForSave });
}

export function useSectionRegistry(fallback: SectionRegistry): SectionRegistry {
  return useContext(RegistryContext) ?? fallback;
}
