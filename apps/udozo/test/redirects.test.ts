import { describe, expect, test } from "vitest";
import config from "../next.config";

describe("moved categories", () => {
  test("Computers' old addresses go for good to Electronics, also on a place's pages", async () => {
    const redirects = await config.redirects!();
    const to = (path: string) => {
      for (const rule of redirects) {
        const names: string[] = [];
        const pattern = rule.source.replace(/:(\w+)(\([^)]*\))?/g, (_, name: string, group?: string) => {
          names.push(name);
          return group ?? "([^/]+)";
        });
        const match = new RegExp(`^${pattern}$`).exec(path);
        if (match) return { destination: names.reduce((dest, name, index) => dest.replace(`:${name}`, match[index + 1]!), rule.destination), permanent: rule.permanent };
      }
      return null;
    };
    expect(to("/c/computers")).toEqual({ destination: "/c/electronics", permanent: true });
    expect(to("/ng/c/computers")).toEqual({ destination: "/ng/c/electronics", permanent: true });
    expect(to("/ng/lagos/computers")).toEqual({ destination: "/ng/lagos/electronics", permanent: true });
    expect(to("/ng/lagos/ikeja/computers")).toEqual({ destination: "/ng/lagos/ikeja/electronics", permanent: true });
    expect(to("/ng/c/laptops")).toBeNull();
  });
});
