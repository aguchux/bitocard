"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { isEditorMessage, type PreviewMessage, previewParents } from "@/lib/preview";

/**
 * Inside the home page editor (only on /home-preview, only when framed by Udozo's admin): blocks are outlined as the
 * pointer passes, a click chooses that block in the editor instead of following its link, a save reads the draft again
 * in place (keeping the scroll), and the editor can scroll to a block. Messages from any other site are ignored, and
 * ours go only to the editor's own origin.
 */
export function PreviewBridge() {
  const router = useRouter();
  useEffect(() => {
    if (window.parent === window) return;
    const allowed = previewParents();
    const parent = (() => {
      try {
        return new URL(document.referrer).origin;
      } catch {
        return null;
      }
    })();
    const target = parent && allowed.includes(parent) ? parent : null;
    if (!target) return;
    const post = (message: PreviewMessage) => window.parent.postMessage(message, target);
    document.documentElement.dataset.editorPreview = "true";

    const onMessage = (event: MessageEvent) => {
      if (event.origin !== target || event.source !== window.parent || !isEditorMessage(event.data)) return;
      if (event.data.type === "refresh") {
        router.refresh();
        return;
      }
      const block = document.querySelector<HTMLElement>(`[data-home-block="${CSS.escape(event.data.id)}"]`) ?? document.querySelector<HTMLElement>(`[data-home-row="${CSS.escape(event.data.id)}"]`);
      if (!block) return;
      document.querySelectorAll("[data-editor-focus]").forEach(element => element.removeAttribute("data-editor-focus"));
      block.dataset.editorFocus = "true";
      block.scrollIntoView?.({ behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" });
    };
    // A click inside a block chooses it in the editor; links do not navigate inside the preview.
    const onClick = (event: MouseEvent) => {
      const element = event.target instanceof Element ? event.target : null;
      if (!element) return;
      const block = element.closest<HTMLElement>("[data-home-block]");
      const row = element.closest<HTMLElement>("[data-home-row]");
      if (element.closest("a")) event.preventDefault();
      if (!block && !row) return;
      event.preventDefault();
      post({ source: "udozo-preview", type: "select", row: row?.dataset.homeRow ?? null, block: block?.dataset.homeBlock ?? null });
    };
    window.addEventListener("message", onMessage);
    document.addEventListener("click", onClick, true);
    post({ source: "udozo-preview", type: "ready" });
    return () => {
      window.removeEventListener("message", onMessage);
      document.removeEventListener("click", onClick, true);
    };
  }, [router]);
  return null;
}
