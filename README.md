# klaviyo-sandbox-seeder

A local web app for seeding a Klaviyo sandbox or trial account with realistic synthetic DTC data, and generating AI-written email campaigns and multi-step flows.

## What it does

**Seed tab**
- Creates 9 standard lists (VIP Champions, Loyal Customers, At-Risk, Lapsed 90+ Days, New Customers, and more) plus a hidden `__Seeder` tracking list used for clean resets
- Generates and upserts profiles with realistic names, emails, US locations, and RFM segment properties
- Tracks events per profile: Placed Order, Fulfilled Order, Viewed Product, Started Checkout
- Supports 3 industry scenarios (Apparel, Beauty, Home & Electronics) with different RFM distributions
- Reset deletes all seeded profiles and lists cleanly

**Generate tab**
- Uses Claude (claude-sonnet-4-6) to write campaign copy: subject, headline, body, CTA, and an AI image prompt
- Generates hero images via Pollinations.ai — contextually relevant to the campaign, no API key needed
- **Email Campaign**: creates a named HTML template in Klaviyo Content → Templates, then creates a draft campaign with the template assigned
- **Multi-step Flow** *(optional)*: creates a 3-email flow using the Klaviyo beta Flows API. Optionally includes a conditional split (phone number is-set) with a yes branch (optionally SMS) and an email no branch

---

## RFM distribution (standard scenario)

| Segment   | %  | Recency      | Orders |
|-----------|----|--------------|--------|
| Champions | 10%| 1–30 days    | 5–15   |
| Loyal     | 20%| 15–60 days   | 3–8    |
| At-Risk   | 20%| 61–120 days  | 2–5    |
| Lapsed    | 25%| 121–365 days | 1–3    |
| New       | 25%| 1–45 days    | 1–2    |

---

## Setup

```bash
npm install
cp .env.example .env
```

Edit `.env` and add your keys:

```
ANTHROPIC_API_KEY=sk-ant-...
```

Your Klaviyo API key is entered in the UI — no need to add it to `.env`.

Get your Klaviyo key: Settings → API Keys → Create Private Key  
Scopes needed: `profiles:read/write`, `lists:read/write`, `events:write`, `templates:read/write`, `campaigns:read/write`, `flows:read/write`

---

## Running locally

```bash
npm run dev
```

Opens the app at [http://localhost:5173](http://localhost:5173). The Express server runs on port 3001 and the Vite dev server proxies API requests to it.

---

## Stack

- **Frontend**: React + Vite (no CSS framework, inline styles)
- **Backend**: Express with SSE streaming for real-time progress logs
- **Klaviyo**: REST API v3 (`2024-10-15`), beta Flows API (`2024-10-15.pre`)
- **AI copy**: Anthropic SDK (`claude-sonnet-4-6`)
- **AI images**: Pollinations.ai (free, no key required)
