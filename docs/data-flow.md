# System Architecture

Three focused diagrams: overall architecture, seeding data flow, and campaign generation data flow.

---

## Overall Architecture

```mermaid
graph TD
    Browser["Browser\nReact + Vite :5173"]
    Server["Express Server\n:3001"]
    Klaviyo["Klaviyo REST API\na.klaviyo.com/api"]
    Anthropic["Anthropic API\nclaude-sonnet-4-6"]
    Pollinations["Pollinations.ai\nAI image generation"]

    Browser -->|"POST /api/seed\nPOST /api/reset\nPOST /api/generate-campaign"| Server
    Server -->|"SSE progress stream\nor JSON response"| Browser
    Server -->|"profiles, lists,\nevents, templates,\ncampaigns, flows"| Klaviyo
    Server -->|"generate copy\n+ image prompt"| Anthropic
    Server -->|"image URL baked\ninto email HTML"| Pollinations
```

---

## Seeding Data Flow

```mermaid
graph TD
    A["/api/seed\nreceives apiKey + scenario + count"]
    B["Create __Seeder list\n+ 9 standard lists"]
    C["Generate profiles\nper RFM segment"]
    D["Upsert each profile\nPOST /profiles/"]
    E["Add profile to\n__Seeder list + segment list"]
    F["Fetch all seeded\nprofile IDs"]
    G["Generate + track events\nPOST /events/\nfor each profile"]
    H["SSE done\nsessionId saved to memory"]

    A --> B
    B --> C
    C --> D
    D --> E
    E -->|"repeat per profile"| D
    E --> F
    F --> G
    G --> H
```

---

## Campaign Generation Data Flow

```mermaid
graph TD
    A["/api/generate-campaign\napiKey + brand + type + options"]
    B["Claude generates copy\nJSON: subject, headline,\nbody, cta, image_prompt"]
    C["buildEmailHtml\nPollinations.ai URL\nbaked into HTML"]

    A --> B
    B --> C

    C --> D{"deliveryType?"}

    D -->|"Email Campaign"| E["POST /templates/\ncreate named template"]
    E --> F["POST /campaigns/\ncreate draft + message stub"]
    F --> G["POST /campaign-message-assign-template/\nlink template to message"]

    D -->|"Multi-step Flow"| H["POST /templates/\none per email step\n(up to 5 templates)"]
    H --> I["POST /flows/ (beta)\nfull action graph:\nemails → delays → split → branches"]
```
