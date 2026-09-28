import { legalContact, legalEntities } from "./legal";
import { appUrl, brand } from "./site";

/** Renders schema.org JSON-LD. `<` is escaped so the payload cannot close the script tag. */
export function JsonLd({ data }: { data: Record<string, unknown> }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }} />;
}

/** Stable @id for the BitoCard organisation, referenced from every app's structured data. */
export const organizationId = () => `${appUrl("storefront")}#organization`;

export function organizationSchema() {
  return {
    "@type": "Organization",
    "@id": organizationId(),
    name: brand.name,
    url: appUrl("storefront"),
    logo: appUrl("storefront", brand.logo),
    parentOrganization: legalEntities.map(entity => ({ "@type": "Organization", name: entity.name })),
    contactPoint: [{ "@type": "ContactPoint", contactType: "legal", email: legalContact }],
  };
}
