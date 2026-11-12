/**
 * Deleting a Udozo account, in words shared by the help page (Google Play's deletion page) and the account's own
 * delete page; the API decides (`AccountDeletionService`), and the privacy notice's section 4d says the same.
 */
export const deletionScreen = "/account/profile/delete";

export const deletionRemoves = [
  "Your name, email address, mobile number, profile photo, cover and username",
  "Where you live, your date of birth and sex",
  "Your sign-in with Google, Facebook or Apple, and your password",
  "Your listings, taken down",
  "Every phone and browser you are signed in on, signed out and forgotten",
];

export const deletionKeeps =
  "What the law makes us keep stays, tied to an account with no details: orders, payments and their accounting, usually for six years.";

export const deletionWaits = "It cannot be done while your wallet or payouts hold money, or while UdozoPay orders or buy orders are under way: finish those first.";
