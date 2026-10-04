"use client";

import { useDeferredValue, useRef, useState } from "react";
import { Copy, ImagePlus, Search, Trash2 } from "lucide-react";
import { ActionDialog, Badge, Button, Card, EmptyState, ErrorState, errorMessage, FilterSelect, formatRelative, Input, Notice, PageHeader, Skeleton } from "@bitocard/admin-ui";
import { AdminShell, can, useAdmin } from "@bitocard/admin-ui/shell";
import { type MediaAsset, type MediaPurpose, useDeleteMediaMutation, useMediaLibraryQuery, useMediaSettingsQuery, useMediaUpload } from "@bitocard/api-client";

const sizeLabel = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

const purposeLabels: Record<MediaPurpose, string> = {
  brand_logo: "Brand logos",
  brand_card: "Gift card and brand images",
  registry_logo: "Brand registry logos",
  registry_card: "Brand registry card images",
  product_image: "Product images",
  supplier_logo: "Supplier logos",
  category_icon: "Category icons",
  category_image: "Category images",
  storefront_image: "Storefront images",
  store_logo: "Reseller store logos",
  store_image: "Reseller store images",
};

function AssetCard({ asset, editable, onDelete }: { asset: MediaAsset; editable: boolean; onDelete: (asset: MediaAsset) => void }) {
  const [copied, setCopied] = useState(false);
  const used = asset.in_use ?? [];
  return (
    <li className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-line bg-white">
      {/* eslint-disable-next-line @next/next/no-img-element -- files on the storage CDN */}
      <img src={asset.url} alt={asset.filename} className="aspect-[4/3] w-full bg-canvas object-contain p-2" loading="lazy" />
      <div className="flex min-w-0 flex-1 flex-col gap-2 p-3 text-sm">
        <p className="truncate font-semibold" title={asset.filename}>
          {asset.filename}
        </p>
        <p className="truncate font-mono text-xs text-muted" title={asset.folder}>
          {asset.folder}
        </p>
        <p className="text-xs text-muted">
          {[asset.width && asset.height ? `${asset.width}×${asset.height}` : null, sizeLabel(asset.size), formatRelative(asset.created_at)].filter(Boolean).join(" · ")}
        </p>
        <div className="flex flex-wrap gap-1">
          {used.length ? (
            used.map(use => (
              <Badge key={use} tone="green" dot={false}>
                {use}
              </Badge>
            ))
          ) : (
            <Badge tone="amber" dot={false}>
              Not used
            </Badge>
          )}
        </div>
        <div className="mt-auto flex flex-wrap gap-2 pt-1">
          <Button
            size="sm"
            variant="ghost"
            icon={<Copy className="size-4" aria-hidden />}
            onClick={async () => {
              await navigator.clipboard?.writeText(asset.url);
              setCopied(true);
            }}
          >
            {copied ? "Copied" : "Copy address"}
          </Button>
          {editable ? (
            <Button size="sm" variant="ghost" icon={<Trash2 className="size-4" aria-hidden />} disabled={used.length > 0} title={used.length ? "Replace it where it is used first" : undefined} onClick={() => onDelete(asset)}>
              Delete
            </Button>
          ) : null}
        </div>
      </div>
    </li>
  );
}

/** Every uploaded logo, icon and image: BitoCard's own and, for checking, resellers'. */
export default function MediaLibraryPage() {
  const admin = useAdmin();
  const editable = can(admin, "operations");
  const [owner, setOwner] = useState("platform");
  const [purpose, setPurpose] = useState<"" | MediaPurpose>("");
  const [search, setSearch] = useState("");
  const q = useDeferredValue(search.trim());
  const settings = useMediaSettingsQuery("admin");
  const library = useMediaLibraryQuery({ realm: "admin", owner, purpose: purpose || undefined, q: q || undefined, limit: 100 });
  const [remove] = useDeleteMediaMutation();
  const [deleting, setDeleting] = useState<MediaAsset | null>(null);
  const upload = useMediaUpload("admin");
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const storefrontRules = settings.data?.purposes.find(item => item.purpose === "storefront_image");

  return (
    <AdminShell section="storefront" current="/storefront/media" crumbs={[{ label: "Storefront", href: "/storefront" }, { label: "Media library" }]}>
      <PageHeader
        title="Media library"
        description="Logos, icons and images uploaded for brands, gift cards, products, suppliers, categories and stores. Files are stored by folder; a file in use cannot be deleted."
        actions={
          editable && settings.data?.configured && storefrontRules ? (
            <>
              <Button icon={<ImagePlus className="size-4" aria-hidden />} loading={uploading} onClick={() => fileInput.current?.click()}>
                Upload storefront image
              </Button>
              <input
                ref={fileInput}
                type="file"
                className="sr-only"
                tabIndex={-1}
                aria-label="Storefront image file"
                accept={storefrontRules.content_types.join(",")}
                onChange={async event => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  setUploading(true);
                  setUploadError(null);
                  try {
                    await upload(file, { purpose: "storefront_image" });
                    setOwner("platform");
                  } catch (failure) {
                    setUploadError(errorMessage(failure));
                  } finally {
                    setUploading(false);
                    event.target.value = "";
                  }
                }}
              />
            </>
          ) : null
        }
      />
      {settings.data && !settings.data.configured ? (
        <Notice tone="amber" title="Uploads are switched off">
          Set up file storage in Settings &gt; Integrations &gt; File storage (DigitalOcean Spaces). Until then, image addresses can be typed in.
        </Notice>
      ) : null}
      {uploadError ? <Notice tone="red">{uploadError}</Notice> : null}
      <div className="flex flex-wrap gap-3">
        <FilterSelect
          id="owner"
          label="Whose"
          value={owner}
          onChange={setOwner}
          options={[
            { value: "platform", label: "BitoCard" },
            { value: "resellers", label: "Resellers" },
          ]}
        />
        <FilterSelect
          id="purpose"
          label="Kind"
          value={purpose}
          onChange={value => setPurpose(value as "" | MediaPurpose)}
          options={[{ value: "", label: "Everything" }, ...Object.entries(purposeLabels).map(([value, label]) => ({ value, label }))]}
        />
        <label className="relative flex min-w-56 flex-1 items-center">
          <span className="sr-only">Search files</span>
          <Search className="pointer-events-none absolute left-4 size-4 text-subtle" aria-hidden />
          <Input type="search" placeholder="Search by file, folder or brand…" value={search} onChange={event => setSearch(event.target.value)} className="min-h-[3.75rem] rounded-2xl pl-11" />
        </label>
      </div>
      {library.error ? (
        <Card>
          <ErrorState message={errorMessage(library.error)} onRetry={library.refetch} />
        </Card>
      ) : !library.data ? (
        <Skeleton className="h-64 w-full" />
      ) : !library.data.data.length ? (
        <Card>
          <EmptyState title="No files">{q || purpose ? "Nothing matches." : "Uploaded images appear here."}</EmptyState>
        </Card>
      ) : (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {library.data.data.map(asset => (
            <AssetCard key={asset.id} asset={asset} editable={editable} onDelete={setDeleting} />
          ))}
        </ul>
      )}
      {deleting ? (
        <ActionDialog
          open
          onClose={() => setDeleting(null)}
          title="Delete this file?"
          description={`${deleting.filename} is removed from storage. This cannot be undone.`}
          confirmLabel="Delete file"
          tone="danger"
          requireReason={false}
          onConfirm={async () => {
            await remove({ realm: "admin", id: deleting.id }).unwrap();
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- files on the storage CDN */}
          <img src={deleting.url} alt="" className="h-32 w-full rounded-xl bg-canvas object-contain" />
        </ActionDialog>
      ) : null}
    </AdminShell>
  );
}
