import {
  conditionLabels,
  shopMoney,
  type ShopCondition,
  type ShopContact,
  type ShopDelivery,
  type ShopFeature,
  type ShopMyListing,
  type ShopPriceKind,
  type ShopState,
  type ShopSuggestion,
  type ShopTopCategory,
  type ShopAssistantProfile,
} from '@shared/classifieds';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { Camera, Images, Sparkles, Star, Trash2 } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { Alert, Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AccountPending } from '@/components/account-pending';
import { CategoryPicker, PickerRow, PlacePicker } from '@/components/pickers';
import { SignedOut } from '@/components/signed-out';
import { ThemedText } from '@/components/themed-text';
import { Button, Card, Chip, Field, FormError, Loading, fieldError } from '@/components/ui';
import { MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAccount } from '@/lib/account';
import { api, ApiError } from '@/lib/api';
import {
  applyDraftSuggestion,
  bodyOf,
  draftOf,
  emptyDraft,
  firstIncomplete,
  lastStep,
  maxPhotos,
  minPhotos,
  photoCounts,
  postSteps,
  stepOf,
  stepProblem,
  type FeatureValue,
  type ListingDraft,
} from '@/lib/listing-form';
import { useMarket } from '@/lib/market';
import { pickPhotos, uploadListingPhoto } from '@/lib/picture';

/** A refusal the form found itself, shaped as the API's so it shows under its field. */
const localError = (message: string, param: string, code = 'parameter_invalid') => new ApiError(400, { type: 'invalid_request_error', code, message, param });

const priceKinds: { key: ShopPriceKind; label: string }[] = [
  { key: 'fixed', label: 'Fixed price' },
  { key: 'negotiable', label: 'Negotiable' },
  { key: 'on_request', label: 'Contact for price' },
];
const deliveries: { key: ShopDelivery; label: string }[] = [
  { key: 'none', label: 'No delivery' },
  { key: 'state', label: 'Within my state' },
  { key: 'nationwide', label: 'Nationwide' },
];
const contacts: { key: ShopContact; label: string }[] = [
  { key: 'both', label: 'Chat and calls' },
  { key: 'chat', label: 'Chat only' },
  { key: 'phone', label: 'Calls only' },
];
type Terms = { version: string; path: string; accepted: boolean; previous_version: string | null };

/**
 * Post an ad, one step a screen (udozo.com's wizard): what it is, photos (camera or library, Fill from photos), price and
 * details, where it is and delivery, then a check and Post. Nothing exists until the first step is saved; after that
 * every Next saves, so leaving keeps a draft to carry on. `id` is `new` or the listing's id (a draft, or a live ad
 * edited).
 */
export default function PostScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const theme = useTheme();
  const queries = useQueryClient();
  const { customer, pending } = useAccount();
  const { country, markets } = useMarket();
  const currency = markets.find(market => market.country === country)?.currency ?? customer?.currency ?? 'NGN';

  const [listingId, setListingId] = useState<string | null>(id && id !== 'new' ? id : null);
  const [draft, setDraft] = useState<ListingDraft | null>(id && id !== 'new' ? null : emptyDraft);
  const [step, setStep] = useState(0);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(0);
  const [picker, setPicker] = useState<'category' | 'place' | null>(null);
  const [posted, setPosted] = useState<ShopMyListing | null>(null);
  const [suggesting, setSuggesting] = useState<'draft' | 'price' | null>(null);
  const [priceHint, setPriceHint] = useState<string | null>(null);
  const [termsTicked, setTermsTicked] = useState(false);

  const listing = useQuery({ queryKey: ['my-listing', listingId], enabled: Boolean(listingId), queryFn: () => api<ShopMyListing>(`/v1/classifieds/me/listings/${listingId}`) });
  const tree = useQuery({ queryKey: ['categories', country], enabled: Boolean(country), staleTime: 10 * 60_000, queryFn: () => api<{ data: ShopTopCategory[] }>(`/v1/classifieds/categories?country=${country}`) });
  const places = useQuery({ queryKey: ['areas', country], enabled: Boolean(country), staleTime: 10 * 60_000, queryFn: () => api<{ data: ShopState[] }>(`/v1/classifieds/areas?country=${country}`) });
  const assistant = useQuery({
    queryKey: ['assistant', 'sell', country],
    enabled: Boolean(country && customer),
    staleTime: 10 * 60_000,
    queryFn: () => api<ShopAssistantProfile>(`/v1/classifieds/assistant?country=${country}&surface=sell`),
  });
  const terms = useQuery({ queryKey: ['shop-terms'], enabled: Boolean(customer), queryFn: () => api<Terms>('/v1/classifieds/terms') });
  const helper = assistant.data?.assistant?.roles.includes('sell') ? assistant.data.assistant.name : null;

  // A saved listing opens at its first unfinished step, once (set while rendering, as React suggests for derived state).
  if (!draft && listing.data) {
    const made = draftOf(listing.data);
    setDraft(made);
    setStep(firstIncomplete(made, photoCounts(listing.data.photos)));
  }

  const categories = useMemo(() => tree.data?.data ?? [], [tree.data]);
  const subcategory = useMemo(() => {
    for (const top of categories) for (const child of top.children) if (child.id === draft?.categoryId) return { top, child };
    return null;
  }, [categories, draft?.categoryId]);
  const features: (ShopFeature & { filter: boolean })[] = subcategory?.child.features ?? [];
  const types = Object.fromEntries(features.map(feature => [feature.key, feature]));
  const photos = listing.data?.photos ?? [];
  const counts = photoCounts(photos, uploading);
  const state = places.data?.data.find(item => item.id === draft?.stateId);
  const area = state?.areas.find(item => item.id === draft?.areaId);

  if (customer === undefined) return <AccountPending />;
  if (customer === null) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }}>
        <SignedOut title="Post an ad" body="Sign in to sell on Udozo. Listing is free." />
      </SafeAreaView>
    );
  }
  if (pending) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.background, padding: Spacing.four, gap: Spacing.three }}>
        <ThemedText themeColor="textSecondary">Finish your account first, then you can post.</ThemedText>
        <Button title="Finish my account" onPress={() => router.replace('/verify')} />
      </SafeAreaView>
    );
  }
  if (!draft || (listingId && listing.isPending)) return <Loading />;

  const change = (patch: Partial<ListingDraft>) => {
    setDraft(current => ({ ...(current ?? emptyDraft), ...patch }));
    setError(null);
  };
  const setFeature = (key: string, value: FeatureValue) => change({ features: { ...draft.features, [key]: value } });

  /** Saves the form: makes the draft the first time, then changes it. Returns the listing's id, or null when refused. */
  const save = async (): Promise<string | null> => {
    const made = bodyOf(draft, types);
    if ('problem' in made) {
      setError(localError(made.problem.message, made.problem.param, 'parameter_invalid'));
      return null;
    }
    try {
      const saved = listingId
        ? await api<ShopMyListing>(`/v1/classifieds/listings/${listingId}`, { method: 'PATCH', body: made.body })
        : await api<ShopMyListing>('/v1/classifieds/listings', { body: made.body });
      queries.setQueryData(['my-listing', saved.id], saved);
      queries.invalidateQueries({ queryKey: ['my-listings'] });
      if (!listingId) setListingId(saved.id);
      return saved.id;
    } catch (caught) {
      setError(caught);
      const back = caught instanceof ApiError ? stepOf(caught.param) : null;
      if (back !== null && back < step) setStep(back);
      return null;
    }
  };

  const next = async () => {
    const problem = stepProblem(step, draft, counts);
    if (problem) {
      setError(localError(problem.message, problem.param, 'parameter_invalid'));
      return;
    }
    setBusy(true);
    const saved = step === 1 ? listingId : await save();
    setBusy(false);
    if (saved) setStep(current => Math.min(lastStep, current + 1));
  };

  const addPhotos = async (from: 'camera' | 'library') => {
    const id = listingId ?? (await save());
    if (!id) return;
    const room = maxPhotos - photos.length - uploading;
    const { photos: picked, refused } = await pickPhotos(from, room).catch(() => ({ photos: [], refused: false }));
    if (refused) {
      Alert.alert(from === 'camera' ? 'Camera turned off' : 'Photos turned off', `Allow Udozo to use your ${from === 'camera' ? 'camera' : 'photos'} in your phone's settings.`, [
        { text: 'Not now', style: 'cancel' },
        { text: 'Open settings', onPress: () => Linking.openSettings() },
      ]);
      return;
    }
    setUploading(count => count + picked.length);
    for (const photo of picked) {
      try {
        await uploadListingPhoto(id, photo);
      } catch (caught) {
        setError(caught);
      } finally {
        setUploading(count => count - 1);
        await queries.invalidateQueries({ queryKey: ['my-listing', id] });
      }
    }
  };

  const removePhoto = async (mediaId: string) => {
    if (!listingId) return;
    try {
      await api(`/v1/classifieds/listings/${listingId}/media/${mediaId}`, { method: 'DELETE' });
      await queries.invalidateQueries({ queryKey: ['my-listing', listingId] });
    } catch (caught) {
      setError(caught);
    }
  };
  const makeCover = async (mediaId: string) => {
    if (!listingId) return;
    try {
      await api(`/v1/classifieds/listings/${listingId}/photos`, { method: 'PATCH', body: { order: [mediaId, ...photos.map(photo => photo.id).filter(item => item !== mediaId)] } });
      await queries.invalidateQueries({ queryKey: ['my-listing', listingId] });
    } catch (caught) {
      setError(caught);
    }
  };

  /** Fill from photos: the assistant reads the photos and offers a title, category, condition, features and description. */
  const fillFromPhotos = async () => {
    if (!listingId) return;
    setSuggesting('draft');
    try {
      const answer = await api<ShopSuggestion>('/v1/classifieds/assistant/suggestions', { body: { kind: 'draft', listing_id: listingId } });
      const offered = answer.kind === 'draft' ? answer.suggestion : null;
      if (!offered) {
        Alert.alert(`${helper ?? 'Anjio'} could not tell`, 'Fill the details in yourself, or add clearer photos and try again.');
        return;
      }
      const lines = [offered.title, offered.category?.name, offered.condition ? conditionLabels[offered.condition] : null, offered.features.length ? `${offered.features.length} details` : null].filter(Boolean).join(' · ');
      Alert.alert(`${helper ?? 'Anjio'} suggests`, lines || 'A description', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Fill the empty fields', onPress: () => change(applyDraftSuggestion(draft, offered)) },
        { text: 'Use all of it', onPress: () => change(applyDraftSuggestion(draft, offered, true)) },
      ]);
    } catch (caught) {
      setError(caught);
    } finally {
      setSuggesting(null);
    }
  };

  /** Suggest a price: the middle of comparable listings' prices in the market (no AI). */
  const suggestPrice = async () => {
    const id = listingId ?? (await save());
    if (!id) return;
    setSuggesting('price');
    try {
      const answer = await api<ShopSuggestion>('/v1/classifieds/assistant/suggestions', { body: { kind: 'price', listing_id: id } });
      const range = answer.kind === 'price' ? answer.suggestion : null;
      if (!range) setPriceHint(answer.kind === 'price' ? answer.note : 'Not enough similar listings to suggest a price yet.');
      else {
        setPriceHint(`Similar ones sell for ${shopMoney(range.low, range.currency)} to ${shopMoney(range.high, range.currency)} (${range.count} listings).`);
        Alert.alert('Use the middle price?', shopMoney(range.median, range.currency), [
          { text: 'No', style: 'cancel' },
          { text: 'Use it', onPress: () => change({ price: String(range.median / 100), priceKind: draft.priceKind === 'on_request' ? 'negotiable' : draft.priceKind }) },
        ]);
      }
    } catch (caught) {
      setError(caught);
    } finally {
      setSuggesting(null);
    }
  };

  const post = async () => {
    setBusy(true);
    try {
      const id = await save();
      if (!id) return;
      // A live ad's changes are saved as they are; only a draft or one sent back is posted again.
      if (listing.data?.status === 'active' || listing.data?.status === 'pending_review') {
        router.back();
        return;
      }
      if (terms.data && !terms.data.accepted) {
        if (!termsTicked) {
          setError(localError('Tick to accept Udozo’s terms first.', 'terms', 'terms_not_accepted'));
          return;
        }
        await api('/v1/classifieds/terms/accept', { body: { version: terms.data.version } });
        await terms.refetch();
      }
      const submitted = await api<ShopMyListing>(`/v1/classifieds/listings/${id}/submit`, { body: {} });
      queries.setQueryData(['my-listing', id], submitted);
      queries.invalidateQueries({ queryKey: ['my-listings'] });
      queries.invalidateQueries({ queryKey: ['dashboard'] });
      setPosted(submitted);
    } catch (caught) {
      setError(caught);
      const back = caught instanceof ApiError ? stepOf(caught.param) : null;
      if (back !== null) setStep(back);
    } finally {
      setBusy(false);
    }
  };

  if (posted) {
    const live = posted.status === 'active';
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }}>
        <Stack.Screen options={{ title: live ? 'Posted' : 'Sent for review' }} />
        <View style={[styles.column, { padding: Spacing.four, gap: Spacing.three }]}>
          <ThemedText type="subtitle" accessibilityRole="header">
            {live ? 'Your ad is live' : 'Your ad is in review'}
          </ThemedText>
          <ThemedText themeColor="textSecondary">
            {live ? 'Buyers can find it now. We will tell you when someone asks about it.' : 'Udozo checks new sellers’ first ads. We will tell you as soon as it is live, usually within a few hours.'}
          </ThemedText>
          <Button title="See my listings" onPress={() => router.replace('/my-listings')} />
          <Button title="Post another ad" tone="secondary" onPress={() => router.replace({ pathname: '/post/[id]', params: { id: 'new' } })} />
        </View>
      </SafeAreaView>
    );
  }

  const problem = (param: string) => fieldError(error, param);
  const title = postSteps[step].title;
  return (
    <SafeAreaView edges={['bottom']} style={{ flex: 1, backgroundColor: theme.background }}>
      <Stack.Screen options={{ title: listing.data && listing.data.status !== 'draft' ? 'Edit your ad' : 'Post an ad' }} />
      <View style={[styles.progress, { backgroundColor: theme.backgroundElement }]} accessibilityLabel={`Step ${step + 1} of ${postSteps.length}`}>
        <View style={{ width: `${((step + 1) / postSteps.length) * 100}%`, height: '100%', backgroundColor: theme.primary }} />
      </View>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: Spacing.six }}>
        <View style={[styles.column, { padding: Spacing.three, gap: Spacing.three }]}>
          <ThemedText type="caption">{`Step ${step + 1} of ${postSteps.length}`}</ThemedText>
          <ThemedText type="subtitle" accessibilityRole="header">
            {title}
          </ThemedText>

          {step === 0 ? (
            <>
              <Field label="Title" value={draft.title} onChangeText={text => change({ title: text })} placeholder="Such as iPhone 13, 128GB, blue" maxLength={90} error={problem('title')} />
              <PickerRow
                label="Category"
                value={subcategory ? `${subcategory.child.name} · ${subcategory.top.name}` : null}
                placeholder={tree.isPending ? 'Loading categories…' : 'Choose a category'}
                onPress={() => setPicker('category')}
                error={problem('category_id')}
              />
            </>
          ) : null}

          {step === 1 ? (
            <>
              <ThemedText themeColor="textSecondary">{`Add at least ${minPhotos} clear photos, up to ${maxPhotos}. The first is the cover.`}</ThemedText>
              <View style={styles.grid}>
                {photos.map((photo, index) => (
                  <View key={photo.id} style={[styles.tile, { borderColor: photo.status === 'failed' ? theme.danger : theme.line }]}>
                    <Image source={{ uri: photo.url }} style={StyleSheet.absoluteFill} contentFit="cover" accessibilityLabel={`Photo ${index + 1}${index === 0 ? ', the cover' : ''}`} />
                    {photo.status === 'failed' ? (
                      <ThemedText type="caption" style={[styles.badge, { backgroundColor: theme.danger, color: theme.onPrimary }]}>Could not use</ThemedText>
                    ) : index === 0 ? (
                      <ThemedText type="caption" style={[styles.badge, { backgroundColor: theme.primary, color: theme.onPrimary }]}>Cover</ThemedText>
                    ) : null}
                    <View style={styles.tileActions}>
                      {index > 0 && photo.status === 'ready' ? (
                        <Pressable accessibilityRole="button" accessibilityLabel={`Make photo ${index + 1} the cover`} hitSlop={8} onPress={() => void makeCover(photo.id)} style={styles.round}>
                          <Star size={16} color="#fff" />
                        </Pressable>
                      ) : null}
                      <Pressable accessibilityRole="button" accessibilityLabel={`Remove photo ${index + 1}`} hitSlop={8} onPress={() => void removePhoto(photo.id)} style={styles.round}>
                        <Trash2 size={16} color="#fff" />
                      </Pressable>
                    </View>
                  </View>
                ))}
                {Array.from({ length: uploading }, (_, index) => (
                  <View key={`up-${index}`} style={[styles.tile, { borderColor: theme.line, alignItems: 'center', justifyContent: 'center' }]}>
                    <ThemedText type="caption">Uploading…</ThemedText>
                  </View>
                ))}
              </View>
              {photos.length + uploading < maxPhotos ? (
                <View style={{ flexDirection: 'row', gap: Spacing.two }}>
                  <Button title="Take photos" icon={<Camera size={18} color={theme.onPrimary} />} onPress={() => void addPhotos('camera')} style={{ flex: 1 }} />
                  <Button title="From gallery" tone="secondary" icon={<Images size={18} color={theme.text} />} onPress={() => void addPhotos('library')} style={{ flex: 1 }} />
                </View>
              ) : null}
              {helper && counts.ready > 0 ? (
                <Card style={{ backgroundColor: theme.backgroundElement }}>
                  <ThemedText type="smallBold">{`Let ${helper} fill it in`}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {`${helper} reads your photos and suggests the title, category, condition and details. You check them before anything is used.`}
                  </ThemedText>
                  <Button title="Fill from photos" tone="secondary" loading={suggesting === 'draft'} icon={<Sparkles size={18} color={theme.primary} />} onPress={() => void fillFromPhotos()} />
                </Card>
              ) : null}
              {problem('photos') ? <ThemedText style={{ color: theme.danger }}>{problem('photos')}</ThemedText> : null}
            </>
          ) : null}

          {step === 2 ? (
            <>
              <View style={styles.chips}>
                {priceKinds.map(kind => (
                  <Chip key={kind.key} label={kind.label} selected={draft.priceKind === kind.key} onPress={() => change({ priceKind: kind.key })} />
                ))}
              </View>
              {draft.priceKind !== 'on_request' ? (
                <Field label={`Price (${currency})`} value={draft.price} onChangeText={text => change({ price: text })} keyboardType="decimal-pad" placeholder="Such as 450,000" error={problem('price')} />
              ) : null}
              <Button title="Suggest a price" tone="ghost" loading={suggesting === 'price'} onPress={() => void suggestPrice()} />
              {priceHint ? <ThemedText type="small" themeColor="textSecondary">{priceHint}</ThemedText> : null}
              <ThemedText type="smallBold">Condition</ThemedText>
              <View style={styles.chips}>
                {(Object.keys(conditionLabels) as ShopCondition[]).map(key => (
                  <Chip key={key} label={conditionLabels[key]} selected={draft.condition === key} onPress={() => change({ condition: key })} />
                ))}
              </View>
              {problem('condition') ? <ThemedText type="small" style={{ color: theme.danger }}>{problem('condition')}</ThemedText> : null}
              {features.map(feature => (
                <FeatureField key={feature.key} feature={feature} value={draft.features[feature.key] ?? null} onChange={value => setFeature(feature.key, value)} />
              ))}
              <Field
                label="Description"
                value={draft.description}
                onChangeText={text => change({ description: text })}
                multiline
                maxLength={5000}
                placeholder="What it is, its condition, what comes with it"
                style={{ minHeight: 120, textAlignVertical: 'top', paddingTop: Spacing.two }}
                error={problem('description')}
              />
              <Field label="How many do you have?" value={draft.stock} onChangeText={text => change({ stock: text })} keyboardType="number-pad" hint="Buyers cannot buy it when none are left." error={problem('stock')} />
            </>
          ) : null}

          {step === 3 && country ? (
            <>
              <PickerRow label="Where is it?" value={area && state ? `${area.name}, ${state.name}` : null} placeholder="Choose the area" onPress={() => setPicker('place')} error={problem('area_id')} />
              <ThemedText type="smallBold">Delivery</ThemedText>
              <View style={styles.chips}>
                {deliveries.map(item => (
                  <Chip key={item.key} label={item.label} selected={draft.delivery === item.key} onPress={() => change({ delivery: item.key })} />
                ))}
              </View>
              {draft.delivery !== 'none' ? (
                <>
                  <Field label="Delivery charge within your state" value={draft.feeState} onChangeText={text => change({ feeState: text })} keyboardType="decimal-pad" placeholder="Empty for free" error={problem('delivery_fee_state')} />
                  {draft.delivery === 'nationwide' ? (
                    <Field label="Delivery charge elsewhere" value={draft.feeNationwide} onChangeText={text => change({ feeNationwide: text })} keyboardType="decimal-pad" placeholder="Empty for free" error={problem('delivery_fee_nationwide')} />
                  ) : null}
                </>
              ) : null}
              <Chip label="Buyers can collect it in person" selected={draft.pickup} onPress={() => change({ pickup: !draft.pickup })} />
              {problem('pickup') ? <ThemedText type="small" style={{ color: theme.danger }}>{problem('pickup')}</ThemedText> : null}
              <ThemedText type="smallBold">How buyers reach you</ThemedText>
              <View style={styles.chips}>
                {contacts.map(item => (
                  <Chip key={item.key} label={item.label} selected={draft.contact === item.key} onPress={() => change({ contact: item.key })} />
                ))}
              </View>
              <ThemedText type="caption">Your phone number is never shown on the ad. Calls go through Udozo.</ThemedText>
            </>
          ) : null}

          {step === lastStep ? (
            <>
              <Summary label="Title" value={draft.title} onChange={() => setStep(0)} />
              <Summary label="Category" value={subcategory?.child.name ?? '—'} onChange={() => setStep(0)} />
              <Summary label="Photos" value={`${counts.ready} photos`} onChange={() => setStep(1)} />
              <Summary label="Price" value={draft.priceKind === 'on_request' ? 'Contact for price' : `${currency} ${draft.price}${draft.priceKind === 'negotiable' ? ', negotiable' : ''}`} onChange={() => setStep(2)} />
              <Summary label="Condition" value={draft.condition ? conditionLabels[draft.condition] : '—'} onChange={() => setStep(2)} />
              <Summary label="Where" value={area && state ? `${area.name}, ${state.name}` : '—'} onChange={() => setStep(3)} />
              {terms.data && !terms.data.accepted ? (
                <Card>
                  <ThemedText type="small">{terms.data.previous_version ? 'Udozo’s terms have changed since you last accepted them.' : 'Posting needs Udozo’s terms accepted once.'}</ThemedText>
                  <Chip label={termsTicked ? 'I accept Udozo’s terms ✓' : 'I accept Udozo’s terms'} selected={termsTicked} onPress={() => setTermsTicked(value => !value)} />
                  <Button title="Read the terms" tone="ghost" onPress={() => WebBrowser.openBrowserAsync(`https://udozo.com${terms.data!.path}`)} />
                </Card>
              ) : null}
              {listingId ? (
                <Button title="More selling options on udozo.com" tone="ghost" onPress={() => WebBrowser.openBrowserAsync(`https://udozo.com/account/listings/${listingId}`)} />
              ) : null}
            </>
          ) : null}

          {error && !(error instanceof ApiError && error.param && ['title', 'category_id', 'price', 'condition', 'area_id', 'photos', 'pickup', 'stock', 'delivery_fee_state', 'delivery_fee_nationwide', 'description'].includes(error.param)) ? <FormError error={error} /> : null}
        </View>
      </ScrollView>
      <View style={[styles.bar, { borderColor: theme.line, backgroundColor: theme.background }]}>
        {step > 0 ? <Button title="Back" tone="secondary" onPress={() => { setError(null); setStep(step - 1); }} style={{ flex: 1 }} /> : null}
        {step < lastStep ? (
          <Button title="Next" loading={busy} disabled={counts.uploading > 0 && step === 1} onPress={() => void next()} style={{ flex: 2 }} />
        ) : (
          <Button title={listing.data?.status === 'active' || listing.data?.status === 'pending_review' ? 'Save changes' : 'Post my ad'} loading={busy} onPress={() => void post()} style={{ flex: 2 }} />
        )}
      </View>

      <CategoryPicker visible={picker === 'category'} onClose={() => setPicker(null)} categories={categories} selected={draft.categoryId} onChoose={categoryId => change({ categoryId, features: categoryId === draft.categoryId ? draft.features : {} })} />
      {country && places.data ? (
        <PlacePicker
          visible={picker === 'place'}
          onClose={() => setPicker(null)}
          country={country}
          states={places.data.data}
          stateId={draft.stateId}
          areaId={draft.areaId}
          onChoose={(chosenState, chosenArea) => change({ stateId: chosenState.id, areaId: chosenArea.id })}
        />
      ) : null}
    </SafeAreaView>
  );
}

/** One of the category's details: text or a number typed, a choice, or yes or no. */
function FeatureField({ feature, value, onChange }: { feature: ShopFeature; value: FeatureValue; onChange: (value: FeatureValue) => void }) {
  const label = feature.unit ? `${feature.name} (${feature.unit})` : feature.name;
  if (feature.data_type === 'boolean') {
    return (
      <View style={{ gap: Spacing.one }}>
        <ThemedText type="smallBold">{label}</ThemedText>
        <View style={styles.chips}>
          <Chip label="Yes" selected={value === true} onPress={() => onChange(value === true ? null : true)} />
          <Chip label="No" selected={value === false} onPress={() => onChange(value === false ? null : false)} />
        </View>
      </View>
    );
  }
  if (feature.data_type === 'choice' && feature.choices.length) {
    return (
      <View style={{ gap: Spacing.one }}>
        <ThemedText type="smallBold">{label}</ThemedText>
        <View style={styles.chips}>
          {feature.choices.map(choice => (
            <Chip key={choice} label={choice} selected={value === choice} onPress={() => onChange(value === choice ? null : choice)} />
          ))}
        </View>
      </View>
    );
  }
  return (
    <Field
      label={label}
      value={value === null ? '' : String(value)}
      onChangeText={text => onChange(text)}
      keyboardType={feature.data_type === 'number' ? 'decimal-pad' : 'default'}
      placeholder={feature.placeholder ?? undefined}
    />
  );
}

function Summary({ label, value, onChange }: { label: string; value: string; onChange: () => void }) {
  const theme = useTheme();
  return (
    <View style={[styles.summary, { borderColor: theme.line }]}>
      <View style={{ flex: 1 }}>
        <ThemedText type="caption">{label}</ThemedText>
        <ThemedText numberOfLines={2}>{value || '—'}</ThemedText>
      </View>
      <Button title="Change" tone="ghost" accessibilityLabel={`Change the ${label.toLowerCase()}`} onPress={onChange} />
    </View>
  );
}

const styles = StyleSheet.create({
  column: { width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  progress: { height: 4, width: '100%' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  tile: { width: '31%', aspectRatio: 1, borderRadius: Radius.medium, borderWidth: 1, overflow: 'hidden' },
  badge: { position: 'absolute', left: 4, top: 4, paddingHorizontal: 6, borderRadius: 6, overflow: 'hidden' },
  tileActions: { position: 'absolute', right: 4, bottom: 4, flexDirection: 'row', gap: 6 },
  round: { width: 30, height: 30, borderRadius: 15, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' },
  summary: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: Spacing.one },
  bar: { flexDirection: 'row', gap: Spacing.two, padding: Spacing.three, borderTopWidth: StyleSheet.hairlineWidth },
});
