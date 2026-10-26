"use client";

import { type StoreSection as Section } from "@bitocard/api-client/storefront";
import { Card, CardHeader } from "../ui/primitives";
import { Notice } from "../ui/status";
import { sectionTypeLabel } from "./grid";
import { type FormProps } from "./inspector-fields";
import { HeroForm, ProductRailForm, CategoryGridForm, BrandGridForm, ProductSpotlightForm } from "./catalogue-forms";
import { PromoForm, TrustBarForm, FeaturesForm, FaqForm } from "./content-forms";
import { QuickBuyForm, CryptoQuoteForm, P2pMarketForm, ListingRailForm, ListingGridForm, ResaleCategoriesForm } from "./template-forms";

export { EditorSourcesProvider, type EditorProduct, type EditorSources } from "./inspector-fields";

function SectionForm({ section, onChange }: FormProps<Section>) {
  switch (section.type) {
    case "hero":
      return <HeroForm section={section} onChange={onChange} />;
    case "product_rail":
      return <ProductRailForm section={section} onChange={onChange} />;
    case "category_grid":
      return <CategoryGridForm section={section} onChange={onChange} />;
    case "brand_grid":
      return <BrandGridForm section={section} onChange={onChange} />;
    case "promo":
      return <PromoForm section={section} onChange={onChange} />;
    case "trust_bar":
      return <TrustBarForm section={section} onChange={onChange} />;
    case "quick_buy":
      return <QuickBuyForm section={section} onChange={onChange} />;
    case "crypto_quote":
      return <CryptoQuoteForm section={section} onChange={onChange} />;
    case "p2p_market":
      return <P2pMarketForm section={section} onChange={onChange} />;
    case "product_spotlight":
      return <ProductSpotlightForm section={section} onChange={onChange} />;
    case "features":
      return <FeaturesForm section={section} onChange={onChange} />;
    case "faq":
      return <FaqForm section={section} onChange={onChange} />;
    case "listing_rail":
      return <ListingRailForm section={section} onChange={onChange} />;
    case "listing_grid":
      return <ListingGridForm section={section} onChange={onChange} />;
    case "resale_categories":
      return <ResaleCategoriesForm section={section} onChange={onChange} />;
  }
}

/** The selected section's settings. Read-only admins see the values with every control disabled. */
export function Inspector({ section, index, error, editable, onChange }: { section: Section | null; index: number; error: string | null; editable: boolean; onChange: (next: Section) => void }) {
  if (!section) {
    return (
      <Card className="p-5 text-sm text-muted">
        <p className="font-semibold text-ink">No section selected</p>
        <p className="mt-1">Select a section on the canvas to change what it shows.</p>
      </Card>
    );
  }
  return (
    <Card>
      <CardHeader title={sectionTypeLabel(section.type)} description={`Section ${index + 1}${section.hidden ? " · hidden" : ""}${editable ? "" : " · view only"}`} />
      <fieldset disabled={!editable} className="min-w-0 space-y-4 p-5 sm:px-6">
        {error ? <Notice tone="red" title="This section cannot be saved">{error}</Notice> : null}
        <SectionForm section={section} onChange={onChange} />
      </fieldset>
    </Card>
  );
}
