

/** Coins typed in: digits with up to the coin's decimal places, above zero. */
export const validAmount = (value: string, decimals: number) => new RegExp(`^\\d{1,12}(?:\\.\\d{1,${decimals}})?$`).test(value.trim()) && Number(value) > 0;

export const reviewText: Record<string, string> = {
  amount: "it is a large amount",
  unscreened: "the address could not be screened",
  recent_card_top_up: "your wallet was recently topped up by card or mobile money",
};
