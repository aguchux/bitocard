---
title: Try it
description: Call the API from these docs against your own sandbox or live account. Sign in with SHQ; a short-lived token is kept in your browser only, and live changes always ask first.
---

# Try it

Reading these docs needs no account. To **call** the API from them, sign in with your SHQ (reseller dashboard) account. Every endpoint in the [reference](/reference) that accepts API keys then has a **Try it** panel.

## How it works

1. **Sign in.** The docs send you to SHQ and bring you back. If you belong to several reseller accounts, choose which one to use.
2. **Choose a mode.** **Sandbox** (the default) calls your sandbox: simulated fulfilment and money. **Live** calls your real account and is shown in red.
3. **Send.** Your browser calls `https://api.bitocard.com` directly with a short-lived token. The request, the response, its status, time and `Request-Id` appear in the panel, with the code to make the same call yourself.

## Your token

The docs never use or ask for your API keys. Instead, BitoCard issues a **"Try it" token** (`bc_docs_…`) for the account and mode you chose:

- It lasts **15 minutes** (a new one is fetched when needed) and only while your SHQ session lasts. Signing out of SHQ ends it at once.
- It is kept in this browser tab's memory only: never stored, never written to the page's address, and never sent to the docs website.
- It has the same scopes and plan rules as an API key. Staff whose role cannot create API keys always get a read-only token.

## Live mode is protected

Live calls are real: they can spend your wallet and send real gift cards, airtime and payouts.

- **Sandbox is the default** every time the docs load.
- Live mode is clearly marked and needs a verified business.
- **Read-only** is on by default in live mode: only `GET` requests can be sent, so you can explore real data with no risk. Turn it off to make changes.
- With read-only off, every live `POST`, `PUT`, `PATCH` or `DELETE` asks you to confirm before it is sent, naming the endpoint and the account.

## What cannot be tried

- **Dashboard-only endpoints** (signing in, API keys, team, notifications, your own integrations) use SHQ's own sign-in and are not callable from the docs.
- **Public endpoints** (countries, exchange rates, the BitoCard store) need no token: Try it calls them without one.
