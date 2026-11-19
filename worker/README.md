# worker/ — probe relay (G2 channel 3)

A Cloudflare Worker that receives the probe's compact results by HTTPS POST and emails them, as plain text, to one fixed
address. It is the optional third channel of **Send results** (spec AC23, AC26). Channels 1 and 2 (share sheet, `mailto:`)
need no server.

**This repository is public. Nothing in `worker/` is a real value.** The Worker URL, the visit code, the recipient, the
sender and the allowed origin are set in the Cloudflare dashboard or typed on the board. Documented placeholders only:
`you@example.com` and `https://relay.example.com/…`.

## Files

| File | Role |
|---|---|
| `relay-core.mjs` | Pure `handleRelay(request, env, deps)`: the whole contract. No platform imports. Tested by `tests/relay-worker.test.js`. |
| `index.mjs` | Thin adapter that wires the `send_email` binding (`env.EMAIL`) into the core. Not unit-tested. |
| `wrangler.example.toml` | Template with no deployment values. Copy to `wrangler.local.toml` (git-ignored). |

## What the Worker does (in this order)

1. `OPTIONS` → CORS preflight for the single allowed origin (never `*`).
2. Any other non-`POST` → 405, `Allow: POST`.
3. `Origin` present and not `ALLOWED_ORIGIN` → 403. (A missing `Origin` is allowed: curl. The visit code is the real gate.)
4. `Content-Type` not `application/json` → 415.
5. Visit code missing or wrong → 401, **before the body is read**. Constant-time compare against the `VISIT_CODE` secret, or a valid unexpired token (below).
6. Body over the cap (`MAX_BYTES`, default 102400) → 413. Checked on `Content-Length` and on the bytes actually read.
7. Not JSON, or not the whitelisted compact shape (unknown key, wrong type, bad `runId` / `hostClassification`) → 400. A smuggled `to` / `bcc` is an unknown key.
8. Builds subject and plain-text body itself from whitelisted fields, with control characters stripped, and sends to `RELAY_TO` from `RELAY_FROM`. Mail binding failure → 502, no detail.
9. 200 `{"ok":true}`.

Every error body is a fixed `{"error":"<code>"}`. Nothing from the request is echoed or logged: only a fixed `relay: reject <status>` line.

## Deploy (owner, once)

Prerequisites: a Cloudflare account, a domain with **Email Routing** enabled, and the destination address verified in Email Routing.
The free Workers plan is enough (100 000 requests/day, 10 ms CPU per request; the Worker does one HMAC, one constant-time compare and one bounded `JSON.parse`).

1. `cp worker/wrangler.example.toml worker/wrangler.local.toml` (the copy is git-ignored).
2. `npx wrangler deploy --config worker/wrangler.local.toml`
3. In the dashboard: Workers & Pages → your Worker → Settings → Variables and Secrets. Add:

   | Name | Type | Value |
   |---|---|---|
   | `VISIT_CODE` | Secret | a long random string, for example `openssl rand -base64 24` |
   | `ALLOWED_ORIGIN` | Text | the probe's origin, scheme and host only: `<probe origin>` (placeholder, set it in the dashboard) |
   | `RELAY_TO` | Text | your verified Email Routing destination, for example `you@example.com` (placeholder) |
   | `RELAY_FROM` | Text | a sender address on your own Email Routing domain |
   | `MAX_BYTES` | Text | optional, default `102400` |

4. Note the Worker URL Cloudflare gives you. Keep it out of the repo.
5. Local dev: put the same names in `worker/.dev.vars` (git-ignored) and run `npx wrangler dev --config worker/wrangler.local.toml`.

`RELAY_TO` and `RELAY_FROM` are variables, never `wrangler.toml` entries, because a pinned address in a tracked file would be a leak (AC25).
Without a pinned destination the `send_email` binding can only reach addresses already verified in your account's Email Routing, so the recipient stays fixed by configuration even if a request tried to name one.

## Visit code, and the private link

The board is a shared display and Chrome may keep a `#fragment` in its history (OQ12 is unverified on the GX), so the private link carries
an **expiring token**, not the long-lived code. The probe also accepts the plain `VISIT_CODE` typed by hand in Send settings.

Mint a token valid for 4 hours:

```bash
VISIT_CODE='<your VISIT_CODE>' node -e "import('./worker/relay-core.mjs').then(async (m) => console.log(await m.mintVisitToken(process.env.VISIT_CODE, Math.floor(Date.now() / 1000) + 4 * 3600)))"
```

The token has the form `v1.<expUnixSeconds>.<signature>`. The Worker recomputes the signature from `VISIT_CODE` and rejects it after the expiry; no state is stored.

Private link (keep it out of the repo, chat history you do not control and screenshots):

```
https://<probe origin>/probe/index.html#relay=<url-encoded Worker URL>&code=<token>
```

On load the probe saves both values on the device, removes the fragment with `history.replaceState`, shows a one-line "imported" banner,
and sends nothing. The code is stored masked and never appears in the export, the log, the summary or `delivery[]`.

## After the visit

- In the probe: **Send settings → Forget send settings** (clears recipient, Worker URL and code from `localStorage`).
- In the dashboard: rotate `VISIT_CODE` (tokens minted from the old value stop working at once).

## Smoke test

```bash
curl -i -X POST 'https://relay.example.com/…' \
  -H 'Content-Type: application/json' -H 'X-Visit-Code: <code or token>' \
  --data '{"v":1,"runId":"probe_test","runState":"empty","complete":false,"hostClassification":"other","scenarios":[],"summary":"test"}'
```

Expect `200 {"ok":true}` and one email. A wrong code returns `401`, a wrong `Origin` `403`, a GET `405`.

## Tests

`node --test tests/relay-worker.test.js` runs the core with a stubbed request, environment and mail effect. `tests/probe-hygiene.test.js` scans `probe/` and `worker/` for email literals, `workers.dev` hosts and account ids.

## Not verified here

- The adapter calls `env.EMAIL.send({ to, from, subject, text })` (current Email Service Workers API as documented by Cloudflare). It was not run against a real binding from this repo. Verify on the first deploy with a test send from the probe; if the account still uses the legacy `EmailMessage` API from `cloudflare:email`, only `index.mjs` changes.
- Whether the free plan lets the Worker reach your destination without a verified sending domain depends on your Email Routing setup.
