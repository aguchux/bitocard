/**
 * What can be uploaded, by whom, where it is stored and its limits. Folders sit under the deployment's top folder
 * (`SPACES_ROOT`): platform files under `platform/`, each reseller's under `resellers/<reseller id>/`, so a bucket is
 * easy to browse and a reseller's files are never mixed with BitoCard's or another reseller's.
 */
export type MediaTarget = 'brand' | 'product' | 'supplier' | 'category' | 'registry';

export type MediaPurpose = {
  label: string;
  realm: 'admin' | 'reseller';
  /** What `target_id` names; purposes without one need none. */
  target?: MediaTarget;
  folder: (target: string | undefined, resellerId: string | undefined) => string;
  maxBytes: number;
  types: readonly string[];
};

export const rasterTypes = ['image/png', 'image/jpeg', 'image/webp'] as const;
/** SVG is accepted from admins only, and checked for scripts and outside references before it is used. */
const withSvg = [...rasterTypes, 'image/svg+xml'] as const;
export const extensions: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/svg+xml': 'svg' };

const KB = 1024;
const MB = 1024 * KB;

/** A safe folder name from a slug, product key part or code: lower case letters, digits, dots, dashes and underscores. */
export const segment = (value: string) =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '')
    .slice(0, 80) || 'item';

const purposeTable = {
  brand_logo: { label: 'Brand logo', realm: 'admin', target: 'brand', folder: slug => `platform/brands/${segment(slug!)}/logos`, maxBytes: 1 * MB, types: withSvg },
  registry_logo: { label: 'Brand registry logo', realm: 'admin', target: 'registry', folder: slug => `platform/brands/${segment(slug!)}/logos`, maxBytes: 1 * MB, types: ['image/png', 'image/svg+xml'] },
  registry_card: { label: 'Brand registry card image', realm: 'admin', target: 'registry', folder: slug => `platform/brands/${segment(slug!)}/cards`, maxBytes: 5 * MB, types: rasterTypes },
  brand_card: { label: 'Gift card or brand card image', realm: 'admin', target: 'brand', folder: slug => `platform/brands/${segment(slug!)}/cards`, maxBytes: 5 * MB, types: rasterTypes },
  product_image: {
    label: 'Product image',
    realm: 'admin',
    target: 'product',
    // category:country:brand:variant becomes products/<category>/<country>/<brand>/<variant>.
    folder: key => `platform/products/${key!.split(':').map(segment).join('/')}`,
    maxBytes: 5 * MB,
    types: withSvg,
  },
  supplier_logo: { label: 'Supplier logo', realm: 'admin', target: 'supplier', folder: code => `platform/suppliers/${segment(code!)}/logos`, maxBytes: 1 * MB, types: withSvg },
  category_icon: { label: 'Category icon', realm: 'admin', target: 'category', folder: category => `platform/categories/${segment(category!)}/icons`, maxBytes: 512 * KB, types: withSvg },
  category_image: { label: 'Category image', realm: 'admin', target: 'category', folder: category => `platform/categories/${segment(category!)}/images`, maxBytes: 5 * MB, types: rasterTypes },
  storefront_image: { label: 'Storefront image', realm: 'admin', folder: () => 'platform/storefront/images', maxBytes: 5 * MB, types: rasterTypes },
  store_logo: { label: 'Store logo', realm: 'reseller', folder: (_target, reseller) => `resellers/${reseller}/store/logos`, maxBytes: 1 * MB, types: rasterTypes },
  store_image: { label: 'Store image', realm: 'reseller', folder: (_target, reseller) => `resellers/${reseller}/store/images`, maxBytes: 5 * MB, types: rasterTypes },
} satisfies Record<string, MediaPurpose>;

export type MediaPurposeKey = keyof typeof purposeTable;
export const mediaPurposes: Record<MediaPurposeKey, MediaPurpose> = purposeTable;
export const mediaPurposeKeys = Object.keys(mediaPurposes) as MediaPurposeKey[];
export const purposesFor = (realm: 'admin' | 'reseller') => mediaPurposeKeys.filter(key => mediaPurposes[key].realm === realm);
