/** The main BitoCard site (sign-up lives there): NEXT_PUBLIC_MAIN_SITE_URL, else production. */
export const mainSiteUrl = (path = "/") => new URL(path, process.env.NEXT_PUBLIC_MAIN_SITE_URL ?? "https://bitocard.com").href;
