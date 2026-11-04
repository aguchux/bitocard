// @vitest-environment jsdom
// The mobile number is never confirmed while signing up: udozo.com's sign-up takes it as typed and the account is made
// with it to confirm later (nothing is texted); a Google sign-up's onboarding asks its name, country and mobile in one
// step; and the profile's About you asks where the customer lives (required there), their date of birth and sex.
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const finishSignUp = vi.fn(async (_input: unknown) => ({ ok: true }));
const sendSignupMobileCode = vi.fn(async () => ({ ok: true }));
vi.mock("@/lib/account-actions", () => ({
  sendSignupEmailCode: async () => ({ ok: true }),
  confirmSignupEmail: async () => ({ ok: true, token: "tok_0123456789abcdefghij" }),
  sendSignupMobileCode: () => sendSignupMobileCode(),
  finishSignUp: (input: unknown) => finishSignUp(input),
  finishProfile: async () => ({}),
  updateAbout: async () => ({}),
  lookupEmail: async () => ({ ok: true }),
  signIn: async () => ({}),
}));

const { SignUpForm } = await import("@/components/account/sign-in-up");
const { ProfileStartForm } = await import("@/components/account-forms");
const { AboutForm, latestBirthDate } = await import("@/components/account/about-form");

const markets = [{ code: "NG", name: "Nigeria", currency: "NGN" }] as never;
const mounted: Array<() => void> = [];
function mount(element: ReturnType<typeof createElement>) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(element));
  mounted.push(() => act(() => root.unmount()));
  return host;
}
afterEach(() => {
  for (const unmount of mounted.splice(0)) unmount();
  document.body.innerHTML = "";
  vi.clearAllMocks();
});
const setValue = (element: HTMLInputElement | HTMLSelectElement, value: string) =>
  act(() => {
    const proto = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(element, value);
    element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  });
const submit = async (host: HTMLElement) =>
  act(async () => {
    host.querySelector("form")!.requestSubmit();
    await new Promise(resolve => setTimeout(resolve, 0));
  });

describe("signing up", () => {
  it("takes the mobile as typed and makes the account with it to confirm later, texting nothing", async () => {
    const host = mount(createElement(SignUpForm, { next: "/sell", markets }));
    setValue(host.querySelector("input[type='email']")!, "ada@example.com");
    await submit(host);
    setValue(host.querySelector("input[name='code']")!, "123456");
    await submit(host);
    setValue(host.querySelector("input[name='first_name']")!, "Ada");
    setValue(host.querySelector("input[name='last_name']")!, "Obi");
    setValue(host.querySelector("select[name='country']")!, "NG");
    await submit(host);
    expect(host.textContent).toContain("Your mobile");
    expect(host.textContent).toContain("You confirm it with a texted code after signing up");
    expect(host.textContent).not.toContain("Text me a code");
    setValue(host.querySelector("input[type='tel']")!, "0803 123 4567");
    await submit(host);
    expect(host.textContent).toContain("Your password");
    expect(host.querySelector("input[name='code']")).toBeNull();
    setValue(host.querySelector("input[type='password']")!, "a long password");
    await submit(host);
    expect(sendSignupMobileCode).not.toHaveBeenCalled();
    expect(finishSignUp).toHaveBeenCalledWith(expect.objectContaining({ country: "NG", phone: "+2348031234567", phoneLater: true }));
  });
});

describe("onboarding a Google sign-up", () => {
  it("asks the name, the country, then the mobile of that country, in one form", () => {
    const host = mount(createElement(ProfileStartForm, { next: "/sell", firstName: "Ada", lastName: null, markets }));
    expect(host.querySelector("input[type='tel']")).toBeNull();
    expect(host.textContent).toContain("Choose your country, then add your mobile number.");
    setValue(host.querySelector("select[name='country']")!, "NG");
    expect(host.querySelector("input[type='tel']")).not.toBeNull();
    expect(host.textContent).toContain("Finish setting up");
    expect(host.querySelectorAll("form")).toHaveLength(1);
  });
});

describe("About you", () => {
  const states = [
    { object: "classified_area", id: "s1", slug: "lagos", name: "Lagos", kind: "state", areas: [{ id: "a1", slug: "ikeja", name: "Ikeja" }] },
    { object: "classified_area", id: "s2", slug: "abuja", name: "Abuja", kind: "state", areas: [{ id: "a2", slug: "wuse", name: "Wuse" }] },
  ] as never;

  it("opens on the saved area's state, and the area waits for a state", () => {
    const saved = mount(createElement(AboutForm, { states, region: "state", areaId: "a2", birthDate: "1994-03-21", sex: "unspecified" }));
    const selects = saved.querySelectorAll("select");
    expect((selects[0] as HTMLSelectElement).value).toBe("abuja");
    expect((selects[1] as HTMLSelectElement).value).toBe("a2");
    expect((saved.querySelector("select[name='sex']") as HTMLSelectElement).value).toBe("unspecified");
    expect((saved.querySelector("input[name='birth_date']") as HTMLInputElement).value).toBe("1994-03-21");

    const fresh = mount(createElement(AboutForm, { states, region: "state", areaId: null, birthDate: null, sex: null }));
    const area = fresh.querySelector("select[name='area_id']") as HTMLSelectElement;
    expect(area.disabled).toBe(true);
    expect(area.required).toBe(true);
    setValue(fresh.querySelectorAll("select")[0] as HTMLSelectElement, "lagos");
    expect((fresh.querySelector("select[name='area_id']") as HTMLSelectElement).disabled).toBe(false);
    expect(fresh.textContent).toContain("Do not specify");
  });

  it("allows dates of birth of people at least 13", () => {
    expect(latestBirthDate(new Date("2026-11-04T10:00:00Z"))).toBe("2013-11-04");
  });
});
