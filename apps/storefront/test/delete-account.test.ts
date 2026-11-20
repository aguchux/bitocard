// The page Google Play links to: deleting the whole account, and deleting some data while keeping it (#some-data).
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
import { setRequest } from "./request";

vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NEXT_NOT_FOUND"); } }));

const page = async () => (await import("@/app/(store)/delete-account/page")).default();

test("explains deleting the account and deleting only some data", async () => {
  setRequest({ host: "bitocard.com" });
  const html = renderToStaticMarkup(await page());
  expect(html).toContain("Delete your BitoCard account");
  expect(html).toContain('id="some-data"');
  expect(html).toContain("Delete some of your data and keep your account");
  expect(html).toContain("Delete%20some%20of%20my%20BitoCard%20data");
});

test("is bitocard.com's only", async () => {
  setRequest({ host: "ada.bitocard.com" });
  await expect(page()).rejects.toThrow("NEXT_NOT_FOUND");
});
