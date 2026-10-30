import { useState } from 'react';
import { ArrowLeft, ArrowRight, LayoutTemplate, Palette, Rocket, Tags } from 'lucide-react';
import { cn } from '../format';
import { Dialog } from './data';
import { Button } from './primitives';

/** The steps of creating a first store, as SHQ's New store and the store's own pages take them. */
export const storeGuideSteps = [
  {
    icon: LayoutTemplate,
    title: 'Choose what you sell',
    body: 'Pick a template: everything in one store, top-ups and bills, gift cards, or a single product. You can change it later.',
  },
  {
    icon: Palette,
    title: 'Make it yours',
    body: 'Choose a design and its colours, add your logo, and pick your store’s address on bitocard.com.',
  },
  {
    icon: Tags,
    title: 'Choose products and prices',
    body: 'List the products your store sells and set your prices or margins. BitoCard supplies and delivers every order.',
  },
  {
    icon: Rocket,
    title: 'Publish and fund your wallet',
    body: 'Publish to open your store. Before customers can pay, verify your identity and fund your wallet, which covers BitoCard’s cost of each order. Those can take longer than the setup.',
  },
] as const;

/**
 * A short guide to creating a first store, one step a screen. `onStart` goes to New store; closing it is `onClose`.
 * On its `last` showing it says it will not come back, and where the steps stay.
 */
export function StoreGuideDialog({ open, onClose, onStart, last = false }: { open: boolean; onClose: () => void; onStart: () => void; last?: boolean }) {
  const [index, setIndex] = useState(0);
  const step = storeGuideSteps[index];
  const final = index === storeGuideSteps.length - 1;
  const Icon = step.icon;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Create your first store"
      description="Store setup takes about five minutes."
      footer={
        <>
          {index === 0 ? (
            <Button variant="ghost" onClick={onClose}>
              Maybe later
            </Button>
          ) : (
            <Button variant="ghost" icon={<ArrowLeft className="size-4" aria-hidden />} onClick={() => setIndex(index - 1)}>
              Back
            </Button>
          )}
          {final ? (
            <Button icon={<Rocket className="size-4" aria-hidden />} onClick={onStart}>
              Create my store
            </Button>
          ) : (
            <Button onClick={() => setIndex(index + 1)}>
              Next
              <ArrowRight className="size-4" aria-hidden />
            </Button>
          )}
        </>
      }
    >
      <div className="flex flex-col items-center gap-4 text-center">
        <span className="grid size-14 place-items-center rounded-2xl bg-brand-50 text-brand-600">
          <Icon className="size-7" aria-hidden />
        </span>
        <div aria-live="polite">
          <p className="text-xs font-semibold tracking-wide text-muted uppercase">
            Step {index + 1} of {storeGuideSteps.length}
          </p>
          <h3 className="mt-1 text-lg font-bold text-ink">{step.title}</h3>
          <p className="mt-2 text-sm text-muted">{step.body}</p>
        </div>
        <ol className="flex items-center gap-2" aria-label="Steps">
          {storeGuideSteps.map((item, at) => (
            <li key={item.title}>
              <button
                type="button"
                onClick={() => setIndex(at)}
                aria-label={`Step ${at + 1}: ${item.title}`}
                aria-current={at === index ? 'step' : undefined}
                className="grid size-8 place-items-center"
              >
                <span className={cn('block h-2 rounded-full transition-all', at === index ? 'w-6 bg-brand-500' : 'w-2 bg-line hover:bg-subtle')} />
              </button>
            </li>
          ))}
        </ol>
        {last ? <p className="text-xs text-muted">You won’t see this again. The steps stay in Get set up on your Home page.</p> : null}
      </div>
    </Dialog>
  );
}
