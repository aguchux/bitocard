"use client";

import type { ShopModel } from "@bitocard/api-client/classifieds";
import { BrandLogo } from "@/components/brand-logo";
import { searchModels } from "@/lib/shop-actions";
import { brandMatchKey, PickField } from "./brand-field";

/**
 * The model field of the listing form: the chosen brand's models in the category, most listed first, those matching what
 * the seller types, and the model as typed when the list lacks it. With no brand yet, what they type finds any brand's
 * model, and choosing one fills the brand in too.
 */
export function ModelField({ value, brand, categoryId, label, placeholder, onChange, onPick }: { value: string; brand: string; categoryId: string | null; label: string; placeholder: string | null; onChange: (value: string) => void; onPick: (model: ShopModel) => void }) {
  const named = brand.trim();
  return (
    <PickField<ShopModel>
      value={value}
      label={label}
      placeholder={named ? "Choose or type it" : (placeholder ?? "Type it")}
      listKey={`${categoryId ?? ""}|${brandMatchKey(named)}`}
      load={async words => {
        if (!categoryId || (!named && words.length < 2)) return [];
        const result = await searchModels(words, named, categoryId);
        return result.ok ? result.data : null;
      }}
      nameOf={model => model.name}
      keyOf={model => `${model.brand?.slug ?? ""}|${model.name}`}
      icon={model => (model.brand ? <BrandLogo brand={model.brand} size="sm" /> : null)}
      hint={model => model.brand?.name}
      freshHint="Not in the list yet: you can still use it."
      onChange={onChange}
      onPick={onPick}
    />
  );
}
