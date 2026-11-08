"use client";

import { useId, useState } from "react";
import { MessageSquarePlus, Plus } from "lucide-react";
import { ActionDialog, Badge, Button, Card, CardHeader, DataTable, Dialog, errorMessage, Field, formatDateTime, Input, Notice, PageHeader, QueryView, Select, Skeleton, Textarea, Toggle } from "@bitocard/admin-ui";
import { can, useAdmin } from "@bitocard/admin-ui/shell";
import { type AdminBoardPost, type BoardPostInput, type BoardPostState, type BoardTone, useBoardPostsQuery, useCreateBoardPostMutation, useDeleteBoardPostMutation, useHomePagesQuery, useUpdateBoardPostMutation } from "@bitocard/api-client/admin";
import { UdozoShell } from "@/components/shell";

/** How each kind of post is marked on udozo.com's dashboard. */
const toneNames: Record<BoardTone, string> = { news: "News", tip: "Tip", alert: "Important" };
const stateTones: Record<BoardPostState, "green" | "grey" | "blue" | "amber"> = { showing: "green", off: "grey", scheduled: "blue", ended: "amber" };
const stateLabels: Record<BoardPostState, string> = { showing: "Showing", off: "Off", scheduled: "Scheduled", ended: "Ended" };
const fields = /^(country|title|body|tone|href|link_label|starts_at|ends_at)$/;

/** A date and time as the browser's datetime-local field wants it, in the admin's own time. */
const local = (iso: string | null) => {
  if (!iso) return "";
  const date = new Date(iso);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

type Market = { code: string; name: string };

function PostForm({ markets, post, onDone }: { markets: Market[]; post: AdminBoardPost | null; onDone: () => void }) {
  const id = useId();
  const [create, created] = useCreateBoardPostMutation();
  const [update, updated] = useUpdateBoardPostMutation();
  const [market, setMarket] = useState(post?.country ?? "");
  const [title, setTitle] = useState(post?.title ?? "");
  const [body, setBody] = useState(post?.body ?? "");
  const [tone, setTone] = useState<BoardTone>(post?.tone ?? "news");
  const [href, setHref] = useState(post?.href ?? "");
  const [label, setLabel] = useState(post?.link_label ?? "");
  const [pinned, setPinned] = useState(post?.pinned ?? false);
  const [enabled, setEnabled] = useState(post?.enabled ?? true);
  const [startsAt, setStartsAt] = useState(local(post?.starts_at ?? null));
  const [endsAt, setEndsAt] = useState(local(post?.ends_at ?? null));
  const state = post ? updated : created;
  const param = ((state.error ?? null) as { param?: string } | null)?.param;
  const errorFor = (name: string) => (param === name ? errorMessage(state.error) : undefined);
  const submit = async () => {
    const input: BoardPostInput = {
      country: market || null,
      title: title.trim(),
      body: body.trim(),
      tone,
      href: href.trim() || null,
      link_label: href.trim() ? label.trim() || null : null,
      pinned,
      enabled,
      starts_at: startsAt ? new Date(startsAt).toISOString() : null,
      ends_at: endsAt ? new Date(endsAt).toISOString() : null,
    };
    const done = post ? update({ id: post.id, ...input }) : create(input);
    if (await done.unwrap().then(() => true).catch(() => false)) onDone();
  };
  return (
    <form
      className="grid gap-4"
      onSubmit={event => {
        event.preventDefault();
        void submit();
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Market" htmlFor={`${id}-market`} hint="Every market’s posts show beside a market’s own." error={errorFor("country")}>
          <Select id={`${id}-market`} value={market} onChange={event => setMarket(event.target.value)}>
            <option value="">Every market</option>
            {markets.map(item => (
              <option key={item.code} value={item.code}>
                {item.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Kind" htmlFor={`${id}-tone`} hint="Important stands out: keep it for what people must act on." error={errorFor("tone")}>
          <Select id={`${id}-tone`} value={tone} onChange={event => setTone(event.target.value as BoardTone)}>
            {Object.entries(toneNames).map(([key, name]) => (
              <option key={key} value={key}>
                {name}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label="Title" htmlFor={`${id}-title`} hint="Up to 100 characters." error={errorFor("title")}>
        <Input id={`${id}-title`} value={title} maxLength={100} onChange={event => setTitle(event.target.value)} required />
      </Field>
      <Field label="Message" htmlFor={`${id}-body`} hint="Plain text, up to 1,000 characters. Line breaks are kept." error={errorFor("body")}>
        <Textarea id={`${id}-body`} value={body} maxLength={1000} rows={5} onChange={event => setBody(event.target.value)} required />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Link" htmlFor={`${id}-href`} hint="Optional: a page on udozo.com (/sell) or an https address (opens in a new tab)." error={errorFor("href")}>
          <Input id={`${id}-href`} value={href} onChange={event => setHref(event.target.value)} placeholder="/safe-trade" />
        </Field>
        <Field label="Link words" htmlFor={`${id}-label`} hint="Optional: Read more when empty. Up to 40 characters." error={errorFor("link_label")}>
          <Input id={`${id}-label`} value={label} maxLength={40} disabled={!href.trim()} onChange={event => setLabel(event.target.value)} />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Starts" htmlFor={`${id}-starts`} hint="Optional: at once when empty." error={errorFor("starts_at")}>
          <Input id={`${id}-starts`} type="datetime-local" value={startsAt} onChange={event => setStartsAt(event.target.value)} />
        </Field>
        <Field label="Ends" htmlFor={`${id}-ends`} hint="Optional: until switched off when empty." error={errorFor("ends_at")}>
          <Input id={`${id}-ends`} type="datetime-local" value={endsAt} onChange={event => setEndsAt(event.target.value)} />
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <span className="flex items-center gap-3">
          <Toggle checked={enabled} onChange={setEnabled} label="Show this post" />
          <span className="text-sm text-ink">{enabled ? "On: shows on udozo.com" : "Off: never shows"}</span>
        </span>
        <span className="flex items-center gap-3">
          <Toggle checked={pinned} onChange={setPinned} label="Pin this post" />
          <span className="text-sm text-ink">{pinned ? "Pinned: shows first" : "Not pinned"}</span>
        </span>
      </div>
      {state.error && !param?.match(fields) ? <Notice tone="red">{errorMessage(state.error)}</Notice> : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" loading={state.isLoading} icon={<MessageSquarePlus className="size-4" aria-hidden />}>
          {post ? "Save post" : "Post it"}
        </Button>
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function Posts({ markets, editable }: { markets: Market[]; editable: boolean }) {
  const [market, setMarket] = useState("");
  const posts = useBoardPostsQuery({ country: market || undefined });
  const [update] = useUpdateBoardPostMutation();
  const [remove] = useDeleteBoardPostMutation();
  const [form, setForm] = useState<AdminBoardPost | "new" | null>(null);
  const [deleting, setDeleting] = useState<AdminBoardPost | null>(null);
  const marketName = (code: string | null) => (code ? (markets.find(item => item.code === code)?.name ?? code) : "Every market");
  return (
    <Card>
      <CardHeader
        title="Posts"
        description="Customers see their market’s posts and every market’s on their dashboard, pinned first, then the newest (ten at most). udozo.com shows changes at once."
        actions={editable ? <Button icon={<Plus className="size-4" aria-hidden />} onClick={() => setForm("new")}>New post</Button> : undefined}
      />
      <div className="flex flex-wrap gap-3 px-5 pb-4 sm:px-6">
        <Select aria-label="Market" value={market} onChange={event => setMarket(event.target.value)} className="w-auto">
          <option value="">Any market</option>
          <option value="global">Every market (shared)</option>
          {markets.map(item => (
            <option key={item.code} value={item.code}>
              {item.name}
            </option>
          ))}
        </Select>
      </div>
      <QueryView query={posts} loading={<Skeleton className="m-5 h-32" />}>
        {data => (
          <DataTable
            rows={data.data}
            rowKey={row => row.id}
            empty="No posts yet."
            columns={[
              {
                key: "post",
                header: "Post",
                cell: row => (
                  <span className="grid gap-0.5">
                    <strong>{row.title}</strong>
                    <span className="line-clamp-2 text-sm text-muted">{row.body}</span>
                  </span>
                ),
              },
              { key: "kind", header: "Kind", cell: row => `${toneNames[row.tone]}${row.pinned ? " · Pinned" : ""}` },
              { key: "market", header: "Market", cell: row => marketName(row.country) },
              { key: "when", header: "When", cell: row => (row.starts_at || row.ends_at ? `${row.starts_at ? formatDateTime(row.starts_at) : "Now"} – ${row.ends_at ? formatDateTime(row.ends_at) : "No end"}` : formatDateTime(row.created_at)) },
              { key: "state", header: "State", cell: row => <Badge tone={stateTones[row.state]}>{stateLabels[row.state]}</Badge> },
              { key: "on", header: "On", cell: row => <Toggle checked={row.enabled} disabled={!editable} label={`Show the post “${row.title}”`} onChange={enabled => void update({ id: row.id, enabled })} /> },
              {
                key: "actions",
                header: "Actions",
                cell: row =>
                  editable ? (
                    <span className="flex gap-2">
                      <Button size="sm" variant="secondary" onClick={() => setForm(row)}>
                        Edit
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setDeleting(row)}>
                        Delete
                      </Button>
                    </span>
                  ) : null,
              },
            ]}
          />
        )}
      </QueryView>
      <Dialog open={form !== null} onClose={() => setForm(null)} title={form === "new" ? "New post" : "Change the post"}>
        {form !== null ? <PostForm markets={markets} post={form === "new" ? null : form} onDone={() => setForm(null)} /> : null}
      </Dialog>
      <ActionDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title="Delete this post?"
        description="It leaves customers’ dashboards at once. Switch it off instead to keep it for later."
        confirmLabel="Delete"
        tone="danger"
        requireReason={false}
        onConfirm={async () => void (await remove(deleting!.id).unwrap())}
      />
    </Card>
  );
}

/** Site › Message board: what Udozo's team tells customers on their account dashboard. */
export default function MessageBoardPage() {
  const admin = useAdmin();
  const editable = can(admin, "operations");
  const pages = useHomePagesQuery();
  return (
    <UdozoShell section="theme" current="/message-board" crumbs={[{ label: "Site", href: "/home-pages" }, { label: "Message board" }]}>
      <PageHeader title="Message board" description="News, tips and important messages for customers, on the dashboard every account opens on udozo.com, for one market or every market." />
      {!editable ? <Notice tone="grey">Only operations admins write and change posts.</Notice> : null}
      <QueryView query={pages} loading={<Skeleton className="h-48 w-full" />}>
        {data => <Posts markets={data.data.filter(item => item.scope === "country").map(item => ({ code: item.page, name: item.name }))} editable={editable} />}
      </QueryView>
    </UdozoShell>
  );
}
