// server.js — Express backend for the Klaviyo Sandbox Seeder web app

import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import express from 'express';
import { DataGenerator } from './generator.js';
import { KlaviyoClient } from './klaviyo.js';

const app = express();
app.use(express.json());

// ── Session store ─────────────────────────────────────────────────────────────
// sessionId (random UUID) → apiKey
// Lives in memory; a server restart or new seed creates a fresh session.
const sessions = new Map();

// ── Scenario distributions ────────────────────────────────────────────────────
const SCENARIO_DISTRIBUTIONS = {
  standard:   { champions: 0.10, loyal: 0.20, at_risk: 0.20, lapsed: 0.25, new: 0.25 },
  growth:     { champions: 0.05, loyal: 0.10, at_risk: 0.10, lapsed: 0.15, new: 0.60 },
  churn_risk: { champions: 0.05, loyal: 0.10, at_risk: 0.35, lapsed: 0.40, new: 0.10 },
};

// ── SSE helper ────────────────────────────────────────────────────────────────
function sse(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function sseHeaders(res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
}

// ── HTML escaping ─────────────────────────────────────────────────────────────
function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Email HTML builder ────────────────────────────────────────────────────────
// Hero images via Pollinations.ai — free AI image generation, no API key needed.
// imagePrompt is a descriptive text prompt; seed keeps the image stable across renders.
function buildEmailHtml(brandName, headline, body1, body2, ctaText, imagePrompt = 'fashion lifestyle clothing editorial photography', seed) {
  const finalPrompt = `${imagePrompt}, professional commercial photography, clean composition, high quality`;
  const seedParam = seed ? `&seed=${seed}` : '';
  const imgSrc = `https://image.pollinations.ai/prompt/${encodeURIComponent(finalPrompt)}?width=1200&height=400&nologo=true${seedParam}`;
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F2EDE3;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:40px 16px">
<table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:4px;overflow:hidden">
  <tr><td style="background:#0D0D0D;padding:24px 40px">
    <span style="color:#fff;font-size:18px;font-weight:700;letter-spacing:-0.02em">${esc(brandName)}</span>
  </td></tr>
  <tr><td style="padding:0">
    <img src="${imgSrc}" width="600" style="display:block;width:100%;height:auto;max-height:300px;object-fit:cover" alt="" />
  </td></tr>
  <tr><td style="padding:48px 40px">
    <h1 style="margin:0 0 20px;font-size:30px;font-weight:800;color:#0D0D0D;letter-spacing:-0.03em;line-height:1.2">${esc(headline)}</h1>
    <p style="margin:0 0 14px;font-size:15px;color:#3D3830;line-height:1.65">${esc(body1)}</p>
    ${body2 ? `<p style="margin:0 0 32px;font-size:15px;color:#3D3830;line-height:1.65">${esc(body2)}</p>` : ''}
    <a href="#" style="display:inline-block;background:#0D0D0D;color:#fff;padding:14px 28px;border-radius:100px;font-size:14px;font-weight:700;text-decoration:none">${esc(ctaText)}</a>
  </td></tr>
  <tr><td style="padding:20px 40px;border-top:1px solid #E8E0D4">
    <p style="margin:0;font-size:12px;color:#8A847C">You're receiving this from ${esc(brandName)}.
    <a href="{{ unsubscribe_url }}" style="color:#8A847C">{% unsubscribe %}</a></p>
  </td></tr>
</table>
</td></tr></table>
</body>
</html>`;
}

// ── Anthropic copy generation ─────────────────────────────────────────────────
async function generateCampaignCopy({ brandName, productName, campaignType, tone, isFlow, includeSMSBranch }) {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) throw new Error('ANTHROPIC_API_KEY environment variable is not set');

  const anthropic = new Anthropic({ apiKey: anthropicKey });

  const toneGuide = {
    aspirational: 'elevated, inspiring, aspirational — speak to who the customer wants to become',
    minimal:      'clean, minimal, spare — let the product speak; strip every unnecessary word',
    playful:      'energetic, playful, conversational — warm, fun, a little cheeky',
  };

  const shape = isFlow
    ? `Return a JSON object with this exact shape (no markdown, no explanation outside the JSON):
{
  "flow_name": "short descriptive flow name",
  "image_prompt": "a descriptive AI image generation prompt (15-25 words) matching the campaign mood and product — e.g. 'neatly folded pastel knitwear on a minimalist white surface with soft morning light'",
  "steps": [
    {
      "step": 1, "type": "email", "delay_hours": 0,
      "subject": "under 50 chars", "preview_text": "under 90 chars",
      "headline": "under 10 words", "body": "2-3 sentences",
      "body2": "2-3 sentences", "cta": "2-5 words"
    },
    {
      "step": 2, "type": "email", "delay_hours": 48,
      "subject": "under 50 chars", "preview_text": "under 90 chars",
      "headline": "under 10 words", "body": "2-3 sentences",
      "body2": "2-3 sentences", "cta": "2-5 words"
    },
    {
      "step": 3, "type": "email", "delay_hours": 72,
      "subject": "under 50 chars", "preview_text": "under 90 chars",
      "headline": "under 10 words", "body": "2-3 sentences",
      "body2": "2-3 sentences", "cta": "2-5 words"
    },
    {
      "step": "split_yes", "type": ${includeSMSBranch ? '"sms"' : '"email"'},
      ${includeSMSBranch
        ? '"body": "max 160 chars SMS — punchy, personal, include brand name and STOP to opt out"'
        : '"subject": "under 50 chars", "preview_text": "under 90 chars", "headline": "under 10 words", "body": "2-3 sentences", "body2": "2-3 sentences", "cta": "2-5 words"'
      }
    },
    {
      "step": "split_no", "type": "email",
      "subject": "under 50 chars", "preview_text": "under 90 chars",
      "headline": "under 10 words", "body": "2-3 sentences",
      "body2": "2-3 sentences", "cta": "2-5 words"
    }
  ]
}`
    : `Return a JSON object with this exact shape (no markdown, no explanation outside the JSON):
{
  "campaign_name": "short descriptive name",
  "subject": "under 50 chars",
  "preview_text": "under 90 chars",
  "headline": "under 10 words",
  "body": "2-3 sentences",
  "body2": "2-3 sentences",
  "cta": "2-5 words",
  "image_prompt": "a descriptive AI image generation prompt (15-25 words) matching the campaign mood and product — e.g. 'cozy neutral bedroom flat lay with folded knit sweater and warm morning light'"
}`;

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1200,
    system: 'You are an expert DTC email marketing copywriter. You always respond with valid JSON only — no markdown fences, no prose outside the JSON. Be specific to the brand and product; never use placeholder brackets.',
    messages: [{
      role: 'user',
      content: `Brand: ${brandName}
Product / offer: ${productName}
Campaign type: ${campaignType}
Tone: ${toneGuide[tone] ?? tone}

${shape}`,
    }],
  });

  const raw = message.content[0].text.trim();
  // Strip markdown code fences if the model adds them despite instructions
  const cleaned = raw.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    throw new Error(`Claude returned invalid JSON. Raw: ${raw.slice(0, 300)}`);
  }
}

// ── Klaviyo campaign creator ──────────────────────────────────────────────────
async function createEmailCampaign(client, copy, { brandName, campaignType }, res) {
  const templateName = copy.campaign_name ?? `${brandName} — ${campaignType}`;
  const imgSeed = Math.floor(Math.random() * 99999);
  const html = buildEmailHtml(brandName, copy.headline, copy.body, copy.body2, copy.cta, copy.image_prompt, imgSeed);

  // Step 1: create a named template so it appears in Content → Templates
  await client._rateLimit();
  const templateId = await client.createTemplate(templateName, html);
  sse(res, 'progress', { message: `  ✓ Template created — "${templateName}" (${templateId})` });
  console.log(`[campaign] template created: ${templateId}`);

  // Step 2: find a list to send to
  const listsRes = await client._fetch('GET', '/lists/');
  const listsData = await listsRes.json();
  const lists = listsData?.data ?? [];
  const target = lists.find(l => l.attributes?.name === 'Newsletter Subscribers') ?? lists[0];
  if (!target) throw new Error('No lists found in Klaviyo — run seeding first');
  sse(res, 'progress', { message: `  Using list: "${target.attributes?.name}"` });

  // Step 3: create the campaign with a message stub (no template yet)
  await client._rateLimit();
  const { campaignId, messageId } = await client.createCampaign({
    name: templateName,
    audiences: { included: [target.id], excluded: [] },
    send_options: { use_smart_sending: false },
    tracking_options: { is_tracking_clicks: true, is_tracking_opens: true },
    send_strategy: { method: 'immediate' },
    'campaign-messages': {
      data: [{
        type: 'campaign-message',
        attributes: {
          channel: 'email',
          label: 'Main message',
          content: {
            subject: copy.subject,
            preview_text: copy.preview_text,
            from_email: 'hello@demo.com',
            from_label: brandName,
            reply_to_email: 'hello@demo.com',
          },
        },
      }],
    },
  });
  sse(res, 'progress', { message: `  ✓ Campaign created (${campaignId})` });

  // Step 4: assign the template via the dedicated action endpoint
  if (messageId) {
    await client._rateLimit();
    await client.assignTemplateToMessage(messageId, templateId);
    sse(res, 'progress', { message: `  ✓ Template assigned to message` });
  }
}

// ── Klaviyo multi-step flow creator ──────────────────────────────────────────
async function probeFlowSchemas(client, copy, { brandName, includeSMSBranch, includeConditionalSplit }, res) {
  // Grab a list ID to use as the trigger target
  const listsRes = await client._fetch('GET', '/lists/');
  const listsData = await listsRes.json();
  const lists = listsData?.data ?? [];
  const triggerList = lists.find(l => l.attributes?.name === 'Newsletter Subscribers') ?? lists[0];
  if (!triggerList) throw new Error('No lists found — run seeding first');
  const listId = triggerList.id;

  const step1 = copy.steps?.[0] ?? {};
  const step2 = copy.steps?.[1] ?? step1;

  const imgPrompt = copy.image_prompt ?? 'fashion lifestyle clothing editorial photography';
  const imgSeed = Math.floor(Math.random() * 99999);
  const emailHtml1 = buildEmailHtml(brandName, step1.headline, step1.body, step1.body2, step1.cta, imgPrompt, imgSeed);
  const emailHtml2 = buildEmailHtml(brandName, step2.headline, step2.body, step2.body2, step2.cta, imgPrompt, imgSeed);

  const flowName = copy.flow_name ?? `${brandName} — AI Flow`;

  // Confirmed schema from Klaviyo docs (2024-10-15.pre):
  // - Actions use `temporary_id` not `id` at create time
  // - Action linking via `links: { next: "temporary_id" }`
  // - Email content in `data.message` with template_id, subject_line, from_email, from_label
  // - Trigger: { type: 'list', id: listId }
  // - entry_action_id references a temporary_id

  sse(res, 'progress', { message: '  Creating email templates for flow steps...' });
  await client._rateLimit();
  const tmplId1 = await client.createTemplate(`${flowName} — Step 1`, emailHtml1);
  await client._rateLimit();
  const tmplId2 = await client.createTemplate(`${flowName} — Step 2`, emailHtml2);
  await client._rateLimit();
  const tmplId3 = copy.steps?.[2]
    ? await client.createTemplate(`${flowName} — Step 3`,
        buildEmailHtml(brandName, copy.steps[2].headline, copy.steps[2].body, copy.steps[2].body2, copy.steps[2].cta, imgPrompt, imgSeed))
    : tmplId2;
  console.log(`[flow] templates created: ${tmplId1}, ${tmplId2}, ${tmplId3}`);

  const emailMsg = (tmplId, step) => ({
    from_email: 'hello@demo.com',
    reply_to_email: 'hello@demo.com',
    from_label: brandName,
    subject_line: step?.subject ?? 'Hello',
    preview_text: step?.preview_text ?? '',
    cc_email: '',
    bcc_email: '',
    template_id: tmplId,
    smart_sending_enabled: false,
  });

  const emailSteps = (copy.steps ?? []).filter(s => typeof s.step === 'number' && s.type === 'email');
  const splitYesStep = copy.steps?.find(s => s.step === 'split_yes');
  const splitNoStep  = copy.steps?.find(s => s.step === 'split_no');
  const actions = [];

  for (let i = 0; i < emailSteps.length; i++) {
    const step = emailSteps[i];
    const tmpl = i === 0 ? tmplId1 : i === 1 ? tmplId2 : tmplId3;
    const delayHours = step.delay_hours ?? 0;
    const emailId = `e${i + 1}`;
    const delayId = `d${i + 1}`;
    const nextEmailId = `e${i + 2}`;
    const isLast = i === emailSteps.length - 1;

    actions.push({
      temporary_id: emailId,
      type: 'send-email',
      links: { next: isLast ? (includeConditionalSplit ? 'split' : null) : (delayHours > 0 ? delayId : nextEmailId) },
      data: { message: emailMsg(tmpl, step) },
    });

    if (!isLast && delayHours > 0) {
      actions.push({
        temporary_id: delayId,
        type: 'time-delay',
        links: { next: nextEmailId },
        data: { unit: 'hours', value: delayHours },
      });
    }
  }

  if (!includeConditionalSplit) {
    // No split — linear flow ends after the last email
    sse(res, 'progress', { message: '  Skipping conditional split — linear flow' });
  } else {

  // Conditional split: splits on phone_number being set
  actions.push({
    temporary_id: 'split',
    type: 'conditional-split',
    links: { next_if_true: 'branch_yes', next_if_false: 'branch_no' },
    data: {
      profile_filter: {
        condition_groups: [{
          conditions: [{
            type: 'profile-property',
            property: 'phone_number',
            filter: { type: 'existence', operator: 'is-set' },
          }],
        }],
      },
    },
  });

  // YES branch: SMS if opted in, otherwise a "bonus" email
  if (includeSMSBranch && splitYesStep?.type === 'sms') {
    actions.push({
      temporary_id: 'branch_yes',
      type: 'send-sms',
      links: { next: null },
      data: {
        status: 'draft',
        message: { body: splitYesStep.body },
      },
    });
  } else {
    // Create a template for the yes-branch email
    const yesTmpl = splitYesStep
      ? await client.createTemplate(`${flowName} — Engaged`,
          buildEmailHtml(brandName, splitYesStep.headline, splitYesStep.body, splitYesStep.body2, splitYesStep.cta, imgPrompt, imgSeed))
      : tmplId3;
    await client._rateLimit();
    actions.push({
      temporary_id: 'branch_yes',
      type: 'send-email',
      links: { next: null },
      data: { message: emailMsg(yesTmpl, splitYesStep) },
    });
  }

  // NO branch: follow-up email for non-SMS profiles
  const noTmpl = splitNoStep
    ? await client.createTemplate(`${flowName} — Follow-up`,
        buildEmailHtml(brandName, splitNoStep.headline, splitNoStep.body, splitNoStep.body2, splitNoStep.cta, imgPrompt, imgSeed))
    : tmplId3;
  await client._rateLimit();
  actions.push({
    temporary_id: 'branch_no',
    type: 'send-email',
    links: { next: null },
    data: { message: emailMsg(noTmpl, splitNoStep) },
  });

  } // end includeConditionalSplit

  await client._rateLimit();
  const flowRes = await client._fetch('POST', '/flows/', {
    data: {
      type: 'flow',
      attributes: {
        name: flowName,
        definition: {
          triggers: [{ type: 'list', id: listId }],
          entry_action_id: 'e1',
          actions,
        },
      },
    },
  }, '2024-10-15.pre');

  console.log(`[flow] create → HTTP ${flowRes.status}`);
  if (!flowRes.ok) {
    const err = await flowRes.json().catch(() => ({}));
    const details = (err.errors ?? []).map(e => e.detail).join(' | ');
    console.log(`[flow] error: ${details}`);
    throw new Error(`Flow creation failed (${flowRes.status}): ${details}`);
  }

  const flowData = await flowRes.json();
  return flowData.data?.id;
}

// ── POST /api/seed ────────────────────────────────────────────────────────────
app.post('/api/seed', async (req, res) => {
  const { apiKey, scenario = 'standard', profileCount = 250 } = req.body;
  if (!apiKey) return res.status(400).json({ error: 'apiKey is required' });

  sseHeaders(res);

  try {
    const client = new KlaviyoClient(apiKey);
    const generator = new DataGenerator({});

    // Quick mode: ≤5 profiles uses 2 segments and capped events so it runs in ~1 min
    const quickMode = profileCount <= 5;
    console.log(`[seed] starting — scenario=${scenario} count=${profileCount}${quickMode ? ' (quick mode)' : ''}`);
    sse(res, 'progress', { message: 'Creating standard lists...', pct: 2 });
    const lists = await client.createStandardLists();
    console.log(`[seed] ${lists.length} lists ready`);
    sse(res, 'progress', { message: `Created ${lists.length} lists`, pct: 10 });

    const baseDist = quickMode
      ? { champions: 0.4, new: 0.6 }
      : (SCENARIO_DISTRIBUTIONS[scenario] ?? SCENARIO_DISTRIBUTIONS.standard);
    // Build segment counts with Math.round, then trim/add any rounding error on the
    // last segment so the total is always exactly profileCount (never 51 for 50, etc.)
    const activeSegs = Object.entries(baseDist)
      .map(([seg, pct]) => [seg, Math.round(profileCount * pct)])
      .filter(([, count]) => count > 0);
    const roundedTotal = activeSegs.reduce((s, [, c]) => s + c, 0);
    activeSegs[activeSegs.length - 1][1] += profileCount - roundedTotal;

    let totalProfiles = 0;
    let segsDone = 0;

    for (const [seg, count] of activeSegs) {
      sse(res, 'progress', { message: `Seeding ${count} "${seg}" profiles...` });
      const profiles = generator.generateProfiles(count, seg);
      const created = await client.upsertProfiles(profiles, seg);
      totalProfiles += created;
      segsDone++;
      const profilePct = 10 + Math.round((segsDone / activeSegs.length) * 25);
      console.log(`[seed] ${seg}: ${created}/${count} profiles`);
      sse(res, 'progress', { message: `  ✓ ${seg}: ${created} profiles added`, pct: profilePct });
    }

    sse(res, 'progress', { message: `${totalProfiles} profiles created — generating events...`, pct: 35 });

    const profileIds = await client.getAllSeededProfileIds();
    const eventTypes = quickMode
      ? ['Placed Order', 'Viewed Product']
      : ['Placed Order', 'Fulfilled Order', 'Viewed Product', 'Started Checkout'];
    const maxEventsPerProfile = quickMode ? 2 : Infinity;
    for (let i = 0; i < eventTypes.length; i++) {
      const eventType = eventTypes[i];
      sse(res, 'progress', { message: `Tracking "${eventType}" events...` });
      const events = generator.generateEvents(profileIds, eventType, 365, maxEventsPerProfile);
      console.log(`[seed] tracking ${events.length} "${eventType}" events...`);
      const tracked = await client.trackEvents(events);
      const eventPct = 35 + Math.round(((i + 1) / eventTypes.length) * 65);
      console.log(`[seed] ✓ ${tracked} "${eventType}" events done`);
      sse(res, 'progress', { message: `  ✓ ${tracked} "${eventType}" events tracked`, pct: eventPct });
    }

    // Save session so campaign generation can reuse the key without re-sending it
    const sessionId = crypto.randomUUID();
    sessions.set(sessionId, apiKey);

    console.log(`[seed] done — ${totalProfiles} profiles seeded`);
    sse(res, 'done', { message: `Done! ${totalProfiles} profiles seeded into Klaviyo.`, sessionId });
  } catch (err) {
    sse(res, 'error', { message: err.message });
  } finally {
    res.end();
  }
});

// ── POST /api/reset ───────────────────────────────────────────────────────────
app.post('/api/reset', async (req, res) => {
  const { apiKey } = req.body;
  if (!apiKey) return res.status(400).json({ error: 'apiKey is required' });

  try {
    const client = new KlaviyoClient(apiKey);
    const submitted = await client.deleteSeededProfiles();
    const listsDeleted = await client.deleteSeededLists();
    const message = submitted === 0 && listsDeleted === 0
      ? 'No seeded data found — nothing to delete. Run a seed first.'
      : `Reset complete — ${submitted} profiles queued for deletion, ${listsDeleted} lists removed.`;
    res.json({ message });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/status ──────────────────────────────────────────────────────────
app.post('/api/status', async (req, res) => {
  const { apiKey } = req.body;
  if (!apiKey) return res.status(400).json({ error: 'apiKey is required' });

  try {
    const client = new KlaviyoClient(apiKey);
    const summary = await client.getSandboxSummary();
    res.json({ summary });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/generate-campaign ───────────────────────────────────────────────
app.post('/api/generate-campaign', async (req, res) => {
  const {
    sessionId,
    brandName,
    productName,
    campaignType,
    tone,
    deliveryType,           // 'Email Campaign' | 'Multi-step Flow'
    includeSMSBranch,       // boolean
    includeConditionalSplit, // boolean
  } = req.body;

  // Accept either a direct apiKey or a sessionId (for backwards compat)
  const apiKey = req.body.apiKey || sessions.get(sessionId);
  if (!apiKey) {
    return res.status(401).json({ error: 'API key required — enter your Klaviyo private key.' });
  }

  sseHeaders(res);

  try {
    const isFlow = deliveryType === 'Multi-step Flow';
    console.log(`[campaign] starting — type=${campaignType} delivery=${deliveryType} brand="${brandName}"`);

    sse(res, 'progress', { message: `Generating ${isFlow ? 'flow' : 'campaign'} copy with Claude...`, pct: 5 });

    const copy = await generateCampaignCopy({
      brandName, productName, campaignType, tone, isFlow, includeSMSBranch,
    });
    console.log(`[campaign] copy generated — ${isFlow ? `flow: "${copy.flow_name}"` : `subject: "${copy.subject}"`}`);

    if (isFlow) {
      sse(res, 'progress', { message: `  Flow name: "${copy.flow_name}"`, pct: 35 });
      sse(res, 'progress', { message: `  Subject (step 1): "${copy.steps?.[0]?.subject ?? '—'}"` });
    } else {
      sse(res, 'progress', { message: `  Subject: "${copy.subject}"`, pct: 35 });
      sse(res, 'progress', { message: `  Headline: "${copy.headline}"` });
    }

    const client = new KlaviyoClient(apiKey);

    if (isFlow) {
      sse(res, 'progress', { message: 'Building multi-step flow in Klaviyo...', pct: 50 });
      const flowId = await probeFlowSchemas(client, copy, { brandName, includeSMSBranch, includeConditionalSplit }, res);
      console.log(`[campaign] flow created — ID: ${flowId}`);
      sse(res, 'done', { message: `Flow "${copy.flow_name}" created in Klaviyo (ID: ${flowId}).` });
    } else {
      sse(res, 'progress', { message: 'Creating email campaign in Klaviyo...', pct: 50 });
      await createEmailCampaign(client, copy, { brandName, campaignType }, res);
      console.log(`[campaign] campaign "${copy.campaign_name ?? campaignType}" created`);
      sse(res, 'done', {
        message: `Campaign "${copy.campaign_name ?? campaignType}" created in Klaviyo (draft).`,
      });
    }
  } catch (err) {
    console.log(`[campaign] error: ${err.message}`);
    sse(res, 'error', { message: err.message });
  } finally {
    res.end();
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`[server] API running at http://localhost:${PORT}`));
