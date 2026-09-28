"use client";

import { useRef, type ReactNode } from "react";

export function InfoDialog({ id, title, children, label = title, variant = "secondary" }: { id: string; title: string; children: ReactNode; label?: string; variant?: "primary" | "secondary" | "nav" }) {
  const dialog = useRef<HTMLDialogElement>(null);
  return (
    <>
      <button className={`button button-${variant}`} type="button" aria-haspopup="dialog" aria-controls={id} onClick={() => dialog.current?.showModal()}>{label}{variant === "primary" ? <span aria-hidden="true"> →</span> : null}</button>
      <dialog ref={dialog} id={id} aria-labelledby={`${id}-title`}>
        <h2 id={`${id}-title`}>{title}</h2>
        <div className="dialog-copy">{children}</div>
        <form method="dialog"><button className="button">Close</button></form>
      </dialog>
    </>
  );
}
