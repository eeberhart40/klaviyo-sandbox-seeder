# klaviyo-sandbox-seeder

MCP server that seeds a Klaviyo sandbox/trial account with realistic synthetic DTC apparel data. Built for partner demo enablement — any partner, any account, one command.

## What it creates

- **Profiles** with realistic names, emails, RFM segments, purchase history properties
- **9 lists**: VIP Champions, Loyal Customers, At-Risk, Lapsed 90+ Days, New Customers, and more  
- **Events**: Placed Order, Fulfilled Order, Viewed Product, Started Checkout — spread across 12 months
- Profiles tagged `_seeder: true` for clean resets

RFM distribution (standard scenario):

| Segment   | % | Recency      | Orders |
|-----------|---|--------------|--------|
| Champions |10%| 1–30 days    | 5–15   |
| Loyal     |20%| 15–60 days   | 3–8    |
| At-Risk   |20%| 61–120 days  | 2–5    |
| Lapsed    |25%| 121–365 days | 1–3    |
| New       |25%| 1–45 days    | 1–2    |

---

## Setup

```bash
npm install
export KLAVIYO_API_KEY=pk_xxxxxxxxxxxx
```

Get your key: Klaviyo → Settings → API Keys → Create Private Key  
Scopes needed: profiles:read/write, lists:read/write, events:write

### Register with Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "klaviyo-seeder": {
      "command": "node",
      "args": ["/absolute/path/to/klaviyo-sandbox-seeder/src/index.js"],
      "env": { "KLAVIYO_API_KEY": "pk_xxxxxxxxxxxx" }
    }
  }
}
```

Restart Claude Desktop.

---

## Usage

Tell Claude in plain English:

- "Seed this Klaviyo account with 250 profiles, standard scenario"
- "Add 50 lapsed customers to the sandbox"  
- "Track 6 months of purchase events for all profiles"
- "Reset the sandbox so I can demo again"

---

## MCP Tools

| Tool | What it does |
|------|-------------|
| `seed_sandbox` | Full seed: lists + profiles + events |
| `seed_profiles` | Profiles only, by segment |
| `seed_events` | Events only for existing profiles |
| `create_lists` | Create standard segment lists |
| `reset_sandbox` | Delete all seeded profiles |
| `describe_sandbox` | Summary of account state |

---

## Extending to other industries

Only `src/generator.js` is brand-specific. To support another vertical, swap out `PRODUCTS`, AOV ranges in `SEGMENT_CONFIG`, and `_eventProps`. The MCP interface and Klaviyo client are fully generic.
