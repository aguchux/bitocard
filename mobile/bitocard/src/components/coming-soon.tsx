import { Card, Page, T } from '@/components/ui';

/** A tab whose screens come in a later phase (docs/BITOCARD_MOBILE_APP_PLAN.md): it says what is coming, never a dead end. */
export function ComingSoon({ title, body, items }: { title: string; body: string; items: string[] }) {
  return (
    <Page header={false}>
      <T kind="title" accessibilityRole="header">
        {title}
      </T>
      <Card>
        <T>{body}</T>
        {items.map(item => (
          <T key={item} muted>
            • {item}
          </T>
        ))}
        <T kind="small" muted>
          Coming soon to the app. Meanwhile it&apos;s all on bitocard.com, with the same account.
        </T>
      </Card>
    </Page>
  );
}
