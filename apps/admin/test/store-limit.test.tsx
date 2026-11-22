import { describe, expect, test } from "vitest";
import { parseStoreLimit } from "../components/store-limit";

describe("the reseller's store ceiling", () => {
  test("blank follows everyone's ceiling; whole numbers from 1 to 1000 are kept; anything else is refused", () => {
    expect(parseStoreLimit("")).toBeNull();
    expect(parseStoreLimit("  ")).toBeNull();
    expect(parseStoreLimit("3")).toBe(3);
    expect(parseStoreLimit("1000")).toBe(1000);
    for (const bad of ["0", "1001", "2.5", "-1", "two"]) expect(parseStoreLimit(bad)).toBeUndefined();
  });
});
