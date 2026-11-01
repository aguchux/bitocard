import { udozoOrigin } from "@/components/theme";

/** udozo.com showing a home page's saved draft, for its preview token. */
export const homePreviewUrl = (page: string, token: string) => `${udozoOrigin()}/home-preview?page=${encodeURIComponent(page.toLowerCase())}&token=${encodeURIComponent(token)}`;
