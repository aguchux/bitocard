// Udozo's social preview cards really draw: a listing's with its photo, one without (sold), and a category's.
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { listingCard, textCard } from "@/lib/og";

const isPng = async (response: Response) => Buffer.from(await response.arrayBuffer()).subarray(1, 4).toString() === "PNG";

test("each card renders a 1200 × 630 PNG", async () => {
  const photo = `data:image/png;base64,${readFileSync(new URL("../public/icon-512.png", import.meta.url)).toString("base64")}`;
  expect(await isPng(await listingCard({ title: "Samsung Galaxy A54, 128 GB, with box and charger", price: "NGN 250,000", place: "Ikeja, Lagos", category: "Mobile phones", condition: "Used", sold: false, photo }))).toBe(true);
  expect(await isPng(await listingCard({ title: "Toyota Corolla 2012", price: "Price on request", place: "Wuse, Abuja", category: "Cars", condition: null, sold: true, photo: null }))).toBe(true);
  expect(await isPng(await textCard({ eyebrow: "Udozo Nigeria", title: "Phones and tablets for sale", line: "Mobile phones · Tablets" }))).toBe(true);
}, 60_000);
