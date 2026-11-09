import type { Application } from "@/lib/connect";

/** An application as the API presents it: a draft with every detail and the three photos, unless overridden. */
export function application(overrides: Partial<Application> = {}): Application {
  return {
    object: "connect_application",
    id: "0b7f1c52-3a3c-4f7e-9c58-2b9b3c8d1e01",
    number: "CA-000012",
    status: "draft",
    country: "NG",
    business_name: "Eze Ventures",
    registration_number: null,
    state: { id: "s1", name: "Lagos" },
    area: { id: "a1", name: "Ikeja" },
    address: "12 Allen Avenue, Ikeja",
    landmark: null,
    hours: "Mon to Sat, 8am to 6pm",
    phone: "08031234567",
    capacity: 200,
    person_name: "Ngozi Eze",
    person_role: "Owner",
    photos: [
      { id: "p1", url: "https://media.test/1.jpg", kind: "shopfront" },
      { id: "p2", url: "https://media.test/2.jpg", kind: "counter" },
      { id: "p3", url: "https://media.test/3.jpg", kind: "storage" },
    ],
    deposit: { amount: null, currency: "NGN", paid_at: null, returned_at: null },
    submitted_at: null,
    changes: null,
    visit: null,
    decision: null,
    withdrawn_at: null,
    centre: null,
    created_at: "2026-11-09T09:00:00.000Z",
    updated_at: "2026-11-09T09:00:00.000Z",
    ...overrides,
  };
}
