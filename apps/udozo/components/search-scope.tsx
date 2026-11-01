"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

/** Where the header's search looks: a location page's state and area, so a search from `/ng/lagos/ikeja` stays there. */
export type SearchPlace = { state?: string | null; area?: string | null };

const Context = createContext<{ place: SearchPlace; setPlace: (place: SearchPlace) => void }>({ place: {}, setPlace: () => undefined });

/** Around the header and the page, so a page can tell the header's search where it is. */
export function SearchScopeProvider({ children }: { children: ReactNode }) {
  const [place, setPlace] = useState<SearchPlace>({});
  return <Context.Provider value={{ place, setPlace }}>{children}</Context.Provider>;
}

/** Rendered by a location page: the header's search keeps its place while the page is open. */
export function SearchScope({ state, area }: SearchPlace) {
  const { setPlace } = useContext(Context);
  useEffect(() => {
    setPlace({ state, area });
    return () => setPlace({});
  }, [state, area, setPlace]);
  return null;
}

export const useSearchPlace = () => useContext(Context).place;
