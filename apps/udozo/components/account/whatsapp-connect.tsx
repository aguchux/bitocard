"use client";

import { useState, useTransition } from "react";
import { MessageCircle, RefreshCw } from "lucide-react";
import { disconnectWhatsapp, setWhatsappChoices, startWhatsappLink, whatsappStatus } from "@/lib/whatsapp-actions";
import type { WhatsappConnection, WhatsappLink } from "@/lib/whatsapp";
import { useConfirm } from "../confirm-dialog";

const button = "inline-flex min-h-11 w-fit items-center gap-2 rounded-xl px-4 font-semibold disabled:opacity-60";

function Choice({ id, label, note, on, busy, onChange }: { id: string; label: string; note: string; on: boolean; busy: boolean; onChange: (next: boolean) => void }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="grid gap-0.5">
        <span id={id} className="font-semibold">
          {label}
        </span>
        <span className="text-sm text-navy-600">{note}</span>
      </span>
      <button type="button" role="switch" aria-checked={on} aria-labelledby={id} disabled={busy} onClick={() => onChange(!on)} className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${on ? "bg-mint-700" : "bg-navy-300"} disabled:opacity-60`}>
        <span className={`absolute top-1 size-5 rounded-full bg-white shadow transition-[left] ${on ? "left-6" : "left-1"}`} />
      </button>
    </div>
  );
}

/**
 * Profile > WhatsApp: **Connect WhatsApp** makes a one-time code and opens WhatsApp with `LINK <code>` ready to send to
 * Udozo's number (sending it from their phone proves the number is theirs); **I sent it** reads the connection again.
 * Once connected: chats and request alerts on WhatsApp, each on or off, and Disconnect (asked first).
 */
export function WhatsappConnect({ initial }: { initial: WhatsappConnection }) {
  const [connection, setConnection] = useState(initial);
  const [link, setLink] = useState<WhatsappLink | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const [confirm, dialog] = useConfirm();

  const connect = () =>
    start(async () => {
      setError(null);
      const result = await startWhatsappLink();
      if (!result.ok) return setError(result.message);
      setLink(result.data);
      if (result.data.link) window.open(result.data.link, "_blank", "noopener");
    });

  const check = () =>
    start(async () => {
      const result = await whatsappStatus();
      if (!result.ok) return setError(result.message);
      setConnection(result.data);
      if (result.data.connected) setLink(null);
      else setError("Not connected yet. Send the message in WhatsApp, then try again.");
    });

  const choose = (input: { chats?: boolean; alerts?: boolean }) => {
    const before = connection;
    setConnection({ ...connection, ...input });
    start(async () => {
      setError(null);
      const result = await setWhatsappChoices(input);
      if (!result.ok) {
        setConnection(before);
        setError(result.message);
      } else setConnection(result.data);
    });
  };

  const disconnect = async () => {
    const answer = await confirm({
      title: "Disconnect WhatsApp?",
      body: "Udozo stops sending your chats and notices to this number, and you can no longer post or chat from it until you connect it again.",
      action: "Disconnect",
      tone: "danger",
    });
    if (!answer) return;
    start(async () => {
      const result = await disconnectWhatsapp();
      if (!result.ok) setError(result.message);
      else setConnection(result.data);
    });
  };

  return (
    <div className="grid gap-4">
      {dialog}
      {connection.connected ? (
        <>
          <p className="text-[15px]">
            Connected to <strong className="text-navy-900">{connection.phone}</strong>.
            {connection.opted_out ? " You sent STOP, so Udozo writes nothing there: send START to Udozo on WhatsApp to come back." : ""}
          </p>
          <Choice id="wa-chats" label="Chats on WhatsApp" note="Messages from buyers and sellers come to WhatsApp, and you answer there. Nobody sees your number." on={connection.chats} busy={busy} onChange={chats => choose({ chats })} />
          <Choice id="wa-alerts" label="Notices on WhatsApp" note="Requests that fit what you sell, answers to yours, buy orders and contact requests." on={connection.alerts} busy={busy} onChange={alerts => choose({ alerts })} />
          <div className="flex flex-wrap gap-2">
            {connection.chat_link ? (
              <a href={connection.chat_link} target="_blank" rel="noopener" className={`${button} bg-mint-700 text-white hover:bg-mint-600`}>
                <MessageCircle className="size-4" aria-hidden="true" /> Open Udozo on WhatsApp
              </a>
            ) : null}
            <button type="button" onClick={() => void disconnect()} disabled={busy} className={`${button} border border-navy-200 hover:border-navy-300`}>
              Disconnect
            </button>
          </div>
        </>
      ) : link ? (
        <div className="grid gap-3">
          <p className="text-[15px]">
            Send <strong className="font-mono text-navy-900">LINK {link.code}</strong> to Udozo ({connection.number}) from the phone you use for WhatsApp. Open WhatsApp has it ready to send. The code works once, for 10 minutes.
          </p>
          <div className="flex flex-wrap gap-2">
            {link.link ? (
              <a href={link.link} target="_blank" rel="noopener" className={`${button} bg-mint-700 text-white hover:bg-mint-600`}>
                <MessageCircle className="size-4" aria-hidden="true" /> Open WhatsApp
              </a>
            ) : null}
            <button type="button" onClick={check} disabled={busy} className={`${button} border border-navy-200 hover:border-navy-300`}>
              <RefreshCw className="size-4" aria-hidden="true" /> I sent it
            </button>
          </div>
        </div>
      ) : (
        <div className="grid gap-3">
          <p className="text-[15px] text-navy-700">
            Find things, chat with buyers and sellers, post ads and ask for what you need, from WhatsApp. Messages go through Udozo&apos;s number, so nobody sees yours.
          </p>
          <button type="button" onClick={connect} disabled={busy} className={`${button} bg-mint-700 text-white hover:bg-mint-600`}>
            <MessageCircle className="size-4" aria-hidden="true" /> Connect WhatsApp
          </button>
          <p className="text-xs text-navy-500">If WhatsApp uses the mobile number confirmed on your account, just send Udozo a message: it connects by itself.</p>
        </div>
      )}
      {error ? (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      ) : null}
    </div>
  );
}
