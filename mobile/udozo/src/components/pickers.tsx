import { brandInitials, brandInk, brandTint, matchCategories, regionWord, type ShopArea, type ShopBrand, type ShopModel, type ShopState, type ShopTopCategory } from '@shared/classifieds';
import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { Check, ChevronRight, Plus } from 'lucide-react-native';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { inter, ThemedText } from '@/components/themed-text';
import { Sheet } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { api } from '@/lib/api';
import { brandMatchKey } from '@/lib/listing-form';

/** A row that opens a picker: what it is, what is chosen, and a chevron. */
export function PickerRow({ label, value, placeholder, onPress, error }: { label: string; value: string | null; placeholder: string; onPress: () => void; error?: string | null }) {
  const theme = useTheme();
  return (
    <View style={{ gap: Spacing.one }}>
      <ThemedText type="smallBold">{label}</ThemedText>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${value ?? placeholder}`}
        onPress={onPress}
        style={[styles.row, { borderColor: error ? theme.danger : theme.line }]}>
        <ThemedText style={{ flex: 1, color: value ? theme.text : theme.textSecondary }}>{value ?? placeholder}</ThemedText>
        <ChevronRight size={18} color={theme.textSecondary} />
      </Pressable>
      {error ? <ThemedText type="small" style={{ color: theme.danger }}>{error}</ThemedText> : null}
    </View>
  );
}

export function Option({ title, detail, selected, icon, onPress }: { title: string; detail?: string; selected?: boolean; icon?: ReactNode; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected: Boolean(selected) }} onPress={onPress} style={[styles.option, { borderColor: theme.line }]}>
      {icon}
      <View style={{ flex: 1 }}>
        <ThemedText>{title}</ThemedText>
        {detail ? <ThemedText type="caption">{detail}</ThemedText> : null}
      </View>
      {selected ? <Check size={18} color={theme.primary} /> : null}
    </Pressable>
  );
}

export function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (text: string) => void; placeholder: string }) {
  const theme = useTheme();
  return (
    <TextInput
      value={value}
      onChangeText={onChange}
      placeholder={placeholder}
      accessibilityLabel={placeholder}
      placeholderTextColor={theme.textSecondary}
      autoCorrect={false}
      style={[styles.search, { borderColor: theme.line, color: theme.text }]}
    />
  );
}

/**
 * Choosing a subcategory: typing finds it by name or by what people call the things sold there (as udozo.com's form);
 * with nothing typed, a top category opens to its subcategories.
 */
export function CategoryPicker({ visible, onClose, categories, selected, onChoose }: { visible: boolean; onClose: () => void; categories: ShopTopCategory[]; selected: string | null; onChoose: (id: string) => void }) {
  const [typed, setTyped] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const found = useMemo(() => (typed.trim().length >= 2 ? matchCategories(categories, typed, 20) : []), [categories, typed]);
  const top = categories.find(item => item.id === open);
  const choose = (id: string) => {
    onChoose(id);
    setTyped('');
    setOpen(null);
    onClose();
  };
  return (
    <Sheet visible={visible} onClose={onClose} title="Choose a category">
      <SearchBox value={typed} onChange={setTyped} placeholder="Search, such as phone or sofa" />
      <ScrollView style={{ maxHeight: 420 }} keyboardShouldPersistTaps="handled">
        {typed.trim().length >= 2 ? (
          found.length ? (
            found.map(({ parent, child }) => <Option key={child.id} title={child.name} detail={parent.name} selected={child.id === selected} onPress={() => choose(child.id)} />)
          ) : (
            <ThemedText type="small" themeColor="textSecondary" style={{ padding: Spacing.two }}>
              No category matches. Try another word, or choose from the list.
            </ThemedText>
          )
        ) : top ? (
          <>
            <Option title={`Back to all categories`} onPress={() => setOpen(null)} />
            {top.children.map(child => <Option key={child.id} title={child.name} selected={child.id === selected} onPress={() => choose(child.id)} />)}
          </>
        ) : (
          categories.map(item => <Option key={item.id} title={item.name} detail={`${item.children.length} subcategories`} onPress={() => setOpen(item.id)} />)
        )}
      </ScrollView>
    </Sheet>
  );
}

/** Choosing where the item is: the state (region, county…), then an area of it. */
export function PlacePicker({ visible, onClose, country, states, stateId, areaId, onChoose }: {
  visible: boolean;
  onClose: () => void;
  country: string;
  states: ShopState[];
  stateId: string | null;
  areaId: string | null;
  onChoose: (state: ShopState, area: ShopArea) => void;
}) {
  const [typed, setTyped] = useState('');
  const [open, setOpen] = useState<string | null>(stateId);
  const word = regionWord(country);
  const plural = word === 'county' ? 'counties' : `${word}s`;
  const state = states.find(item => item.id === open);
  const words = typed.trim().toLowerCase();
  const list = state ? state.areas.filter(area => !words || area.name.toLowerCase().includes(words)) : states.filter(item => !words || item.name.toLowerCase().includes(words));
  return (
    <Sheet visible={visible} onClose={onClose} title={state ? `Area of ${state.name}` : `Choose the ${word}`}>
      <SearchBox value={typed} onChange={setTyped} placeholder={state ? 'Search areas' : `Search ${plural}`} />
      <ScrollView style={{ maxHeight: 420 }} keyboardShouldPersistTaps="handled">
        {state ? <Option title={`Another ${word}`} onPress={() => { setOpen(null); setTyped(''); }} /> : null}
        {state
          ? (list as ShopArea[]).map(area => (
              <Option
                key={area.id}
                title={area.name}
                selected={area.id === areaId}
                onPress={() => {
                  onChoose(state, area);
                  setTyped('');
                  onClose();
                }}
              />
            ))
          : (list as ShopState[]).map(item => <Option key={item.id} title={item.name} selected={item.id === stateId} onPress={() => { setOpen(item.id); setTyped(''); }} />)}
      </ScrollView>
    </Sheet>
  );
}

/** A brand's logo, or its initials on its colour (udozo.com's `BrandLogo`, small). */
export function BrandLogo({ brand, size = 28 }: { brand: Pick<ShopBrand, 'slug' | 'name' | 'logo_url' | 'color'>; size?: number }) {
  const tint = brandTint(brand);
  const logo = brand.logo_url ? (brand.logo_url.startsWith('/') ? `https://udozo.com${brand.logo_url}` : brand.logo_url) : null;
  return (
    <View accessibilityElementsHidden style={[styles.logo, { width: size, height: size, backgroundColor: logo ? '#fff' : tint }]}>
      {logo ? (
        <Image source={{ uri: logo }} style={StyleSheet.absoluteFill} contentFit="contain" />
      ) : (
        <ThemedText style={{ color: brandInk(tint), fontFamily: inter.bold, fontSize: size * 0.36 }}>{brandInitials(brand.name)}</ThemedText>
      )}
    </View>
  );
}

/**
 * A registry's picker (brands, models): the list as soon as it opens, what matches as the seller types (asked 200 ms
 * after they stop), and Use "…" when nothing listed is what they typed, so a brand or model the list lacks is kept as
 * typed (matched on letters and digits only, as udozo.com's `brandMatchKey`).
 */
export function RemotePicker<Item>({ visible, onClose, title, value, queryKey, load, nameOf, keyOf, iconOf, detailOf, freshHint, onPick, onUse }: {
  visible: boolean;
  onClose: () => void;
  title: string;
  value: string;
  queryKey: readonly unknown[];
  load: (words: string) => Promise<Item[]>;
  nameOf: (item: Item) => string;
  keyOf: (item: Item) => string;
  iconOf?: (item: Item) => ReactNode;
  detailOf?: (item: Item) => string | undefined;
  freshHint: string;
  onPick: (item: Item) => void;
  onUse: (typed: string) => void;
}) {
  const theme = useTheme();
  const [typed, setTyped] = useState(value);
  const [words, setWords] = useState(value.trim());
  // Each opening starts from what the field holds (set while rendering, as React suggests for derived state).
  const [shown, setShown] = useState(visible);
  if (visible !== shown) {
    setShown(visible);
    if (visible) {
      setTyped(value);
      setWords(value.trim());
    }
  }
  useEffect(() => {
    const wait = setTimeout(() => setWords(typed.trim()), 200);
    return () => clearTimeout(wait);
  }, [typed]);
  const list = useQuery({ queryKey: [...queryKey, words], enabled: visible, staleTime: 60_000, queryFn: () => load(words) });
  const items = list.data ?? [];
  const exact = items.some(item => brandMatchKey(nameOf(item)) === brandMatchKey(typed.trim()));
  const fresh = typed.trim().length >= 1 && !exact;
  const choose = (done: () => void) => {
    done();
    onClose();
  };
  return (
    <Sheet visible={visible} onClose={onClose} title={title}>
      <SearchBox value={typed} onChange={setTyped} placeholder="Choose or type it" />
      <ScrollView style={{ maxHeight: 420 }} keyboardShouldPersistTaps="handled">
        {items.map(item => (
          <Option
            key={keyOf(item)}
            title={nameOf(item)}
            detail={detailOf?.(item)}
            icon={iconOf?.(item)}
            selected={Boolean(value.trim()) && brandMatchKey(nameOf(item)) === brandMatchKey(value)}
            onPress={() => choose(() => onPick(item))}
          />
        ))}
        {fresh ? <Option title={`Use “${typed.trim()}”`} detail={freshHint} icon={<Plus size={18} color={theme.primary} />} onPress={() => choose(() => onUse(typed.trim()))} /> : null}
        {list.isError ? (
          <ThemedText type="small" themeColor="textSecondary" style={{ padding: Spacing.two }}>
            The list could not be loaded. Type it instead.
          </ThemedText>
        ) : !items.length && !fresh && !list.isPending ? (
          <ThemedText type="small" themeColor="textSecondary" style={{ padding: Spacing.two }}>
            Type it to find it.
          </ThemedText>
        ) : null}
        {value.trim() ? <Option title="Clear it" onPress={() => choose(() => onUse(''))} /> : null}
      </ScrollView>
    </Sheet>
  );
}

/** The listing's brand: the category's brands with their logos, those matching what is typed, or the brand as typed. */
export function BrandPicker({ visible, onClose, categoryId, country, value, onPick, onUse }: {
  visible: boolean;
  onClose: () => void;
  categoryId: string | null;
  country: string | null;
  value: string;
  onPick: (brand: ShopBrand) => void;
  onUse: (typed: string) => void;
}) {
  return (
    <RemotePicker<ShopBrand>
      visible={visible}
      onClose={onClose}
      title="Brand"
      value={value}
      queryKey={['brands', categoryId, country]}
      load={async words => {
        const params = new URLSearchParams({ limit: words ? '12' : '24' });
        if (categoryId) params.set('category', categoryId);
        if (country) params.set('country', country);
        if (words) params.set('q', words.slice(0, 60));
        return (await api<{ data: ShopBrand[] }>(`/v1/classifieds/brands?${params}`)).data;
      }}
      nameOf={brand => brand.name}
      keyOf={brand => brand.slug}
      iconOf={brand => <BrandLogo brand={brand} />}
      freshHint="Not in the list yet: we will look at adding it."
      onPick={onPick}
      onUse={onUse}
    />
  );
}

/**
 * The listing's model: the chosen brand's models in the category, those matching what is typed, or the model as typed.
 * With no brand yet, what is typed finds any brand's model, and choosing one fills the brand in.
 */
export function ModelPicker({ visible, onClose, categoryId, brand, value, onPick, onUse }: {
  visible: boolean;
  onClose: () => void;
  categoryId: string | null;
  brand: string;
  value: string;
  onPick: (model: ShopModel) => void;
  onUse: (typed: string) => void;
}) {
  const named = brand.trim();
  return (
    <RemotePicker<ShopModel>
      visible={visible}
      onClose={onClose}
      title={named ? `${named} model` : 'Model'}
      value={value}
      queryKey={['models', categoryId, brandMatchKey(named)]}
      load={async words => {
        if (!categoryId || (!named && words.length < 2)) return [];
        const params = new URLSearchParams({ category: categoryId, limit: '30' });
        if (named) params.set('brand', named.slice(0, 60));
        if (words) params.set('q', words.slice(0, 60));
        return (await api<{ data: ShopModel[] }>(`/v1/classifieds/models?${params}`)).data;
      }}
      nameOf={model => model.name}
      keyOf={model => `${model.brand?.slug ?? ''}|${model.name}`}
      iconOf={model => (model.brand ? <BrandLogo brand={model.brand} /> : undefined)}
      detailOf={model => (named ? undefined : model.brand?.name)}
      freshHint="Not in the list yet: you can still use it."
      onPick={onPick}
      onUse={onUse}
    />
  );
}

const styles = StyleSheet.create({
  logo: { borderRadius: Radius.small, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  row: { minHeight: 48, borderWidth: 1, borderRadius: Radius.medium, paddingHorizontal: Spacing.three, flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  option: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: Spacing.two, borderBottomWidth: StyleSheet.hairlineWidth, paddingHorizontal: Spacing.one },
  search: { minHeight: 44, borderWidth: 1, borderRadius: Radius.medium, paddingHorizontal: Spacing.three, fontSize: 16 },
});
