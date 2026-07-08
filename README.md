# Glowline

**Sell the house before you light it.** Glowline is the kitchen-table sales tool for
permanent & holiday lighting installers: trace a customer's roofline on a photo of
*their* house, preview it glowing in any season, and hand them a priced, branded
proposal — in one flow, on one screen.

![status](https://img.shields.io/badge/stage-MVP-ffb257) ![type](https://img.shields.io/badge/stack-zero--build%20web-10162a)

---

## Why this exists (the business case)

Permanent exterior lighting is one of the fastest-growing home services in North America
— roughly **45–60% YoY**, average project **~$6,000**, margins above the trade average.
The software around it splits awkwardly in two:

- **Full CRMs** (Jobber, QuoteIQ, JingleCRM) — great at scheduling, invoicing, rebooking.
- **A visual mockup tool** (Strandr) — used *separately* to show the customer the look.

Installers pay for both and stitch them together. The highest-leverage moment — the one
that actually **closes the $6k sale at the doorstep** — is the visual "here's *your* house,
lit" conversation. That's the wedge Glowline owns, and it ships the priced proposal in the
same breath instead of bouncing to a second tool.

**Monetization:** $39/mo per installer (self-serve), or per-proposal credits for
seasonal/occasional operators. Natural expansion: a "customer opens the proposal" link,
saved customer library, crew hand-off, deposit collection via Stripe.

## What it does today

- **Trace the roofline** on a photo (or the built-in demo house) — click along the eaves,
  drag any point to adjust. A warm light-string blooms across the roof as you go.
- **Multiple roof runs** — trace the main gable, then hit **New run** for the detached
  garage or porch. Each section is independent; footage and nodes sum across all of them.
- **Preview any season** — Warm White, Cool White, Christmas, Halloween, Fourth of July,
  Fall Amber. The nodes recolor live and the scene dims to night so it reads like dusk.
- **Real measurements** — set scale by clicking two points on something of known length
  (garage door ≈ 16 ft), and every foot of roofline is priced from that.
- **Live estimate** — auto per-foot line item from the trace, plus fully editable line
  items, tax, and deposit. Permanent vs. seasonal pricing presets.
- **Branded proposal** — generates a print/PDF-ready document with the lit-house preview
  embedded, itemized scope, totals, and a signature block.
- **Shareable link** — one click copies a link that opens a clean, customer-facing
  read-only proposal (the whole thing is encoded in the URL — no backend). The customer
  can review, "Accept & request install," or save it as a PDF.
- **Saved proposals** — everything persists locally; reopen and keep working.

Everything runs client-side. No accounts, no backend, no build step.

> **Note on share links:** because the proposal (including the house image) is packed into
> the URL, links get long. Fine to send by email or a messaging app that accepts long links;
> a future backend will mint short links. Uploaded photos are auto-downscaled to keep links
> as small as possible.

## Run it

Any static file server works. For example:

```bash
cd glowline
python3 -m http.server 4173
# open http://localhost:4173
```

Or drag `index.html` onto a browser. To deploy, drop the folder on Netlify / Vercel /
Cloudflare Pages / GitHub Pages — it's just static files.

## Keyboard

`T` trace · `S` set scale · `R` new run · `N` toggle night · `Backspace` undo last point

## Files

| File | Role |
|------|------|
| `index.html` | Structure — topbar, canvas stage, estimate rail, proposal & saved sheets |
| `styles.css` | Design system — midnight palette, incandescent glow, Archivo/Hanken/Plex type |
| `app.js` | Everything else — tracing, scale, live glow render, pricing, proposal, persistence |

## Roadmap to a paid product

1. **Accounts + cloud sync** (Supabase/Postgres) so proposals follow the installer across devices,
   and **short share links** (store the proposal server-side, send a tiny URL).
2. **Online accept + deposit** (Stripe) on the shared proposal — the close happens online.
   *(Read-only shareable proposals already ship; see above.)*
3. **Customer & job library**, rebooking reminders (the recurring-revenue hook).
4. **AI roofline assist** — auto-detect eaves from the uploaded photo so tracing is one tap.
5. **Material/BOM export** for the install crew (channel length, node count, power injection).

---

*Built as a standalone MVP. Point a fresh GitHub repo at this folder and push.*
