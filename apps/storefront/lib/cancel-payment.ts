/** Why a payment could not be cancelled (`?cancel_error=<code>` after the cancel action), as the page says it. */
const cancelErrors: Record<string, string> = {
  payment_in_progress: "This payment has been made and is still being confirmed, so it cannot be cancelled. We will confirm it shortly.",
};

export const cancelErrorText = (code: string) => cancelErrors[code] ?? "We could not cancel this payment just now. Try again in a minute.";
