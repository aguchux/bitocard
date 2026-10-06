"use client";

import { useEffect, useRef } from "react";

/**
 * Submits its form as soon as a field changes, and marks the form `data-auto` so it can hide its Apply button. Before
 * this script runs (or without script) the form keeps its button and works as a plain form.
 */
export function SubmitOnChange() {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const form = ref.current?.closest("form");
    if (!form) return;
    const submit = () => form.requestSubmit();
    form.addEventListener("change", submit);
    form.dataset.auto = "";
    return () => {
      form.removeEventListener("change", submit);
      delete form.dataset.auto;
    };
  }, []);
  return <span ref={ref} hidden />;
}
