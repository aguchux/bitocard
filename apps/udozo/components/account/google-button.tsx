import { continueWithGoogle } from "@/lib/google-actions";

/** Google's "G", in its own colours, as Google's sign-in branding asks. */
export function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" className="size-5" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

/**
 * "Continue with Google": signing in (an account that signed up with Google), or signing up (a new account, which then
 * gives its name, country and mobile). `ref` is a campaign's or invite's code, kept on the account it makes.
 */
export function GoogleButton({ intent, next, refCode = null }: { intent: "signin" | "signup"; next: string; refCode?: string | null }) {
  return (
    <form action={continueWithGoogle}>
      <input type="hidden" name="intent" value={intent} />
      <input type="hidden" name="next" value={next} />
      {refCode ? <input type="hidden" name="ref" value={refCode} /> : null}
      <button type="submit" className="inline-flex min-h-12 w-full items-center justify-center gap-2.5 rounded-xl border border-navy-200 bg-white px-5 font-bold text-navy-900 hover:border-navy-300 hover:bg-navy-50">
        <GoogleMark />
        {intent === "signup" ? "Sign up with Google" : "Continue with Google"}
      </button>
    </form>
  );
}

/** The line between Google and the email form. */
export function OrDivider() {
  return (
    <p className="my-4 flex items-center gap-3 text-xs font-semibold tracking-wide text-navy-400 uppercase">
      <span className="h-px flex-1 bg-navy-100" />
      or with your email
      <span className="h-px flex-1 bg-navy-100" />
    </p>
  );
}
