import { matchCategories, regionWord, type ShopArea, type ShopState, type ShopTopCategory } from '@shared/classifieds';
import { Check, ChevronRight } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Sheet } from '@/components/ui';
import { Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

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

function Option({ title, detail, selected, onPress }: { title: string; detail?: string; selected?: boolean; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ selected: Boolean(selected) }} onPress={onPress} style={[styles.option, { borderColor: theme.line }]}>
      <View style={{ flex: 1 }}>
        <ThemedText>{title}</ThemedText>
        {detail ? <ThemedText type="caption">{detail}</ThemedText> : null}
      </View>
      {selected ? <Check size={18} color={theme.primary} /> : null}
    </Pressable>
  );
}

function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (text: string) => void; placeholder: string }) {
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

const styles = StyleSheet.create({
  row: { minHeight: 48, borderWidth: 1, borderRadius: Radius.medium, paddingHorizontal: Spacing.three, flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  option: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: Spacing.two, borderBottomWidth: StyleSheet.hairlineWidth, paddingHorizontal: Spacing.one },
  search: { minHeight: 44, borderWidth: 1, borderRadius: Radius.medium, paddingHorizontal: Spacing.three, fontSize: 16 },
});
