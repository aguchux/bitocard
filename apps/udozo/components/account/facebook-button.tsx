import { continueWithFacebook } from "@/lib/facebook-actions";

/** Facebook's "f", white on its blue circle, as Facebook's sign-in branding asks. */
export function FacebookMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" aria-hidden="true">
      <circle cx="12" cy="12" r="12" fill="#1877F2" />
      <path fill="#fff" d="M16.67 15.47 17.2 12h-3.33V9.75c0-.95.47-1.87 1.96-1.87h1.51V4.92s-1.37-.23-2.68-.23c-2.74 0-4.53 1.66-4.53 4.66V12H7.08v3.47h3.05V24a12.1 12.1 0 0 0 3.74 0v-8.53h2.8z" />
    </svg>
  );
}

/**
 * "Continue with Facebook", beside Google's: signing in, or signing up (a new account, which confirms its email with
 * Udozo's code, then gives its name, country and mobile). `ref` is a campaign's or invite's code, kept on the account.
 */
export function FacebookButton({ intent, next, refCode = null }: { intent: "signin" | "signup"; next: string; refCode?: string | null }) {
  return (
    <form action={continueWithFacebook}>
      <input type="hidden" name="intent" value={intent} />
      <input type="hidden" name="next" value={next} />
      {refCode ? <input type="hidden" name="ref" value={refCode} /> : null}
      <button type="submit" className="inline-flex min-h-12 w-full items-center justify-center gap-2.5 rounded-xl border border-navy-200 bg-white px-5 font-bold text-navy-900 hover:border-navy-300 hover:bg-navy-50">
        <FacebookMark />
        {intent === "signup" ? "Sign up with Facebook" : "Continue with Facebook"}
      </button>
    </form>
  );
}
