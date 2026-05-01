// mcp-server.js — stdio MCP entry point for Claude Desktop
// Exposes the same tools as the HTTP /mcp endpoint in server.js.
// Claude Desktop spawns this as a child process via the config below.
//
// claude_desktop_config.json:
// {
//   "mcpServers": {
//     "klaviyo-sandbox-seeder": {
//       "command": "node",
//       "args": ["/absolute/path/to/mcp-server.js"]
//     }
//   }
// }

import 'dotenv/config';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { KlaviyoClient } from './klaviyo.js';
import { DataGenerator } from './generator.js';
import Anthropic from '@anthropic-ai/sdk';

function resolveKey(api_key) {
  const key = api_key || process.env.KLAVIYO_API_KEY;
  if (!key) throw new Error('No Klaviyo API key — either pass api_key or set KLAVIYO_API_KEY in .env');
  return key;
}

const SCENARIO_DISTRIBUTIONS = {
  standard:   { champions: 0.10, loyal: 0.20, at_risk: 0.20, lapsed: 0.25, new: 0.25 },
  growth:     { champions: 0.05, loyal: 0.10, at_risk: 0.10, lapsed: 0.15, new: 0.60 },
  churn_risk: { champions: 0.05, loyal: 0.10, at_risk: 0.35, lapsed: 0.40, new: 0.10 },
};

const toneGuide = {
  aspirational: 'elevated, inspiring, aspirational — speak to who the customer wants to become',
  minimal:      'clean, minimal, spare — let the product speak; strip every unnecessary word',
  playful:      'energetic, playful, conversational — warm, fun, a little cheeky',
};

async function generateCopy({ brandName, productName, campaignType, tone, isFlow, includeSMSBranch }) {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const shape = isFlow
    ? `Return JSON with this shape (no markdown):
{
  "flow_name": "short name",
  "image_prompt": "15-25 word AI image prompt matching campaign mood",
  "steps": [
    { "step": 1, "type": "email", "delay_hours": 0, "subject": "...", "preview_text": "...", "headline": "...", "body": "...", "body2": "...", "cta": "..." },
    { "step": 2, "type": "email", "delay_hours": 48, "subject": "...", "preview_text": "...", "headline": "...", "body": "...", "body2": "...", "cta": "..." },
    { "step": 3, "type": "email", "delay_hours": 72, "subject": "...", "preview_text": "...", "headline": "...", "body": "...", "body2": "...", "cta": "..." },
    { "step": "split_yes", "type": "${includeSMSBranch ? 'sms' : 'email'}", ${includeSMSBranch ? '"body": "max 160 chars SMS"' : '"subject": "...", "preview_text": "...", "headline": "...", "body": "...", "body2": "...", "cta": "..."'} },
    { "step": "split_no", "type": "email", "subject": "...", "preview_text": "...", "headline": "...", "body": "...", "body2": "...", "cta": "..." }
  ]
}`
    : `Return JSON with this shape (no markdown):
{
  "campaign_name": "short name",
  "subject": "...", "preview_text": "...", "headline": "...",
  "body": "...", "body2": "...", "cta": "...",
  "image_prompt": "15-25 word AI image prompt matching campaign mood"
}`;

  const msg = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1200,
    system: 'Expert DTC email copywriter. Respond with valid JSON only — no markdown fences.',
    messages: [{ role: 'user', content: `Brand: ${brandName}\nProduct: ${productName}\nType: ${campaignType}\nTone: ${toneGuide[tone] ?? tone}\n\n${shape}` }],
  });
  const raw = msg.content[0].text.trim().replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/i, '').trim();
  return JSON.parse(raw);
}

function buildEmailHtml(brandName, headline, body1, body2, ctaText, imagePrompt = 'fashion lifestyle clothing editorial photography', seed) {
  const finalPrompt = `${imagePrompt}, professional commercial photography, clean composition, high quality`;
  const seedParam = seed ? `&seed=${seed}` : '';
  const imgSrc = `https://image.pollinations.ai/prompt/${encodeURIComponent(finalPrompt)}?width=1200&height=400&nologo=true${seedParam}`;
  const esc = s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#F2EDE3;font-family:sans-serif">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:40px 16px">
<table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:4px;overflow:hidden">
  <tr><td style="background:#0D0D0D;padding:24px 40px"><span style="color:#fff;font-size:18px;font-weight:700">${esc(brandName)}</span></td></tr>
  <tr><td style="padding:0"><img src="${imgSrc}" width="600" style="display:block;width:100%;height:auto;max-height:300px;object-fit:cover" alt="" /></td></tr>
  <tr><td style="padding:48px 40px">
    <h1 style="margin:0 0 20px;font-size:30px;font-weight:800;color:#0D0D0D">${esc(headline)}</h1>
    <p style="margin:0 0 14px;font-size:15px;color:#3D3830;line-height:1.65">${esc(body1)}</p>
    ${body2 ? `<p style="margin:0 0 32px;font-size:15px;color:#3D3830;line-height:1.65">${esc(body2)}</p>` : ''}
    <a href="#" style="display:inline-block;background:#0D0D0D;color:#fff;padding:14px 28px;border-radius:100px;font-size:14px;font-weight:700;text-decoration:none">${esc(ctaText)}</a>
  </td></tr>
  <tr><td style="padding:20px 40px;border-top:1px solid #E8E0D4">
    <p style="margin:0;font-size:12px;color:#8A847C">You're receiving this from ${esc(brandName)}. <a href="{{ unsubscribe_url }}" style="color:#8A847C">{% unsubscribe %}</a></p>
  </td></tr>
</table></td></tr></table></body></html>`;
}

const mcp = new McpServer({ name: 'klaviyo-sandbox-seeder', version: '1.0.0' });

// ── seed_sandbox ──────────────────────────────────────────────────────────────
mcp.registerTool('seed_sandbox', {
  description: 'Seed a Klaviyo sandbox end-to-end: creates lists, profiles with RFM segments, and historical events.',
  inputSchema: {
    api_key:       z.string().optional().describe('Klaviyo private API key — omit to use KLAVIYO_API_KEY from .env'),
    profile_count: z.number().optional().describe('Number of profiles (default: 50)'),
    scenario:      z.enum(['standard', 'growth', 'churn_risk']).optional().describe('standard | growth | churn_risk'),
  },
}, async ({ api_key, profile_count = 50, scenario = 'standard' }) => {
  const client = new KlaviyoClient(resolveKey(api_key));
  const generator = new DataGenerator({});
  const lines = [];

  const lists = await client.createStandardLists();
  lines.push(`✓ ${lists.length} lists created`);

  const dist = SCENARIO_DISTRIBUTIONS[scenario];
  const activeSegs = Object.entries(dist).map(([s, p]) => [s, Math.round(profile_count * p)]).filter(([,c]) => c > 0);
  activeSegs[activeSegs.length - 1][1] += profile_count - activeSegs.reduce((s,[,c]) => s+c, 0);

  let total = 0;
  for (const [seg, count] of activeSegs) {
    const profiles = generator.generateProfiles(count, seg);
    const created = await client.upsertProfiles(profiles, seg);
    total += created;
    lines.push(`  ✓ ${seg}: ${created} profiles`);
  }
  lines.push(`✓ ${total} profiles seeded`);

  const ids = await client.getAllSeededProfileIds();
  for (const type of ['Placed Order', 'Fulfilled Order', 'Viewed Product', 'Started Checkout']) {
    const events = generator.generateEvents(ids, type, 365);
    const tracked = await client.trackEvents(events);
    lines.push(`✓ ${tracked} "${type}" events`);
  }
  lines.push('\nSandbox ready.');
  return { content: [{ type: 'text', text: lines.join('\n') }] };
});

// ── reset_sandbox ─────────────────────────────────────────────────────────────
mcp.registerTool('reset_sandbox', {
  description: 'Delete all seeded profiles and lists. Deletion is async — dashboards clear within 24h.',
  inputSchema: {
    api_key: z.string().optional().describe('Klaviyo private API key — omit to use KLAVIYO_API_KEY from .env'),
    confirm: z.boolean().describe('Must be true to proceed'),
  },
}, async ({ api_key, confirm }) => {
  if (!confirm) return { content: [{ type: 'text', text: 'Aborted — pass confirm: true to proceed.' }] };
  const client = new KlaviyoClient(resolveKey(api_key));
  const profiles = await client.deleteSeededProfiles();
  const lists = await client.deleteSeededLists();
  return { content: [{ type: 'text', text: `Reset complete — ${profiles} profiles queued for deletion, ${lists} lists removed.` }] };
});

// ── reset_generated ───────────────────────────────────────────────────────────
mcp.registerTool('reset_generated', {
  description: 'Delete all seeder-generated campaigns, flows, and templates (identified by [seeder] in name).',
  inputSchema: {
    api_key: z.string().optional().describe('Klaviyo private API key — omit to use KLAVIYO_API_KEY from .env'),
    confirm: z.boolean().describe('Must be true to proceed'),
  },
}, async ({ api_key, confirm }) => {
  if (!confirm) return { content: [{ type: 'text', text: 'Aborted — pass confirm: true to proceed.' }] };
  const client = new KlaviyoClient(resolveKey(api_key));
  const campaigns = await client.deleteSeededCampaigns();
  const flows = await client.deleteSeededFlows();
  const templates = await client.deleteSeededTemplates();
  return { content: [{ type: 'text', text: `Reset complete — ${campaigns} campaign(s), ${flows} flow(s), ${templates} template(s) deleted.` }] };
});

// ── generate_campaign ─────────────────────────────────────────────────────────
mcp.registerTool('generate_campaign', {
  description: 'Use Claude to write copy and create a draft email campaign in Klaviyo with an AI-generated hero image.',
  inputSchema: {
    api_key:       z.string().optional().describe('Klaviyo private API key — omit to use KLAVIYO_API_KEY from .env'),
    brand_name:    z.string().describe('Brand name'),
    product_name:  z.string().describe('Product or offer'),
    campaign_type: z.string().describe('e.g. "New Product Launch", "Win-Back"'),
    tone:          z.enum(['aspirational', 'minimal', 'playful']).optional(),
  },
}, async ({ api_key, brand_name, product_name, campaign_type, tone = 'aspirational' }) => {
  const client = new KlaviyoClient(resolveKey(api_key));
  const copy = await generateCopy({ brandName: brand_name, productName: product_name, campaignType: campaign_type, tone, isFlow: false, includeSMSBranch: false });
  const templateName = `${copy.campaign_name ?? `${brand_name} — ${campaign_type}`} [seeder]`;
  const imgSeed = Math.floor(Math.random() * 99999);
  const html = buildEmailHtml(brand_name, copy.headline, copy.body, copy.body2, copy.cta, copy.image_prompt, imgSeed);
  const templateId = await client.createTemplate(templateName, html);

  const listsRes = await client._fetch('GET', '/lists/');
  const lists = (await listsRes.json())?.data ?? [];
  const target = lists.find(l => l.attributes?.name === 'Newsletter Subscribers') ?? lists[0];
  if (!target) throw new Error('No lists found — run seed_sandbox first');

  await client._rateLimit();
  const { campaignId, messageId } = await client.createCampaign({
    name: templateName,
    audiences: { included: [target.id], excluded: [] },
    send_options: { use_smart_sending: false },
    tracking_options: { is_tracking_clicks: true, is_tracking_opens: true },
    send_strategy: { method: 'immediate' },
    'campaign-messages': { data: [{ type: 'campaign-message', attributes: { channel: 'email', label: 'Main message', content: { subject: copy.subject, preview_text: copy.preview_text, from_email: 'hello@demo.com', from_label: brand_name, reply_to_email: 'hello@demo.com' } } }] },
  });
  if (messageId) {
    await client._rateLimit();
    await client.assignTemplateToMessage(messageId, templateId);
  }
  return { content: [{ type: 'text', text: `Campaign "${templateName}" created in Klaviyo as a draft (ID: ${campaignId}).` }] };
});

// ── generate_flow ─────────────────────────────────────────────────────────────
mcp.registerTool('generate_flow', {
  description: 'Use Claude to write copy and create a multi-step email flow in Klaviyo.',
  inputSchema: {
    api_key:                   z.string().optional().describe('Klaviyo private API key — omit to use KLAVIYO_API_KEY from .env'),
    brand_name:                z.string().describe('Brand name'),
    product_name:              z.string().describe('Product or offer'),
    campaign_type:             z.string().describe('e.g. "Win-Back", "Post-Purchase"'),
    tone:                      z.enum(['aspirational', 'minimal', 'playful']).optional(),
    include_conditional_split: z.boolean().optional().describe('Add conditional split on phone_number (default: true)'),
    include_sms:               z.boolean().optional().describe('Yes branch sends SMS (default: false)'),
  },
}, async ({ api_key, brand_name, product_name, campaign_type, tone = 'aspirational', include_conditional_split = true, include_sms = false }) => {
  const client = new KlaviyoClient(resolveKey(api_key));
  const includeSMSBranch = include_conditional_split && include_sms;
  const copy = await generateCopy({ brandName: brand_name, productName: product_name, campaignType: campaign_type, tone, isFlow: true, includeSMSBranch });
  const flowName = `${copy.flow_name ?? `${brand_name} — AI Flow`} [seeder]`;
  const imgPrompt = copy.image_prompt ?? 'fashion lifestyle editorial photography';
  const imgSeed = Math.floor(Math.random() * 99999);

  const listsRes = await client._fetch('GET', '/lists/');
  const lists = (await listsRes.json())?.data ?? [];
  const triggerList = lists.find(l => l.attributes?.name === 'Newsletter Subscribers') ?? lists[0];
  if (!triggerList) throw new Error('No lists found — run seed_sandbox first');

  const steps = (copy.steps ?? []).filter(s => typeof s.step === 'number' && s.type === 'email');
  const splitYes = copy.steps?.find(s => s.step === 'split_yes');
  const splitNo  = copy.steps?.find(s => s.step === 'split_no');

  await client._rateLimit();
  const tmpl1 = await client.createTemplate(`${flowName} — Step 1`, buildEmailHtml(brand_name, steps[0]?.headline, steps[0]?.body, steps[0]?.body2, steps[0]?.cta, imgPrompt, imgSeed));
  await client._rateLimit();
  const tmpl2 = await client.createTemplate(`${flowName} — Step 2`, buildEmailHtml(brand_name, steps[1]?.headline, steps[1]?.body, steps[1]?.body2, steps[1]?.cta, imgPrompt, imgSeed));
  await client._rateLimit();
  const tmpl3 = steps[2] ? await client.createTemplate(`${flowName} — Step 3`, buildEmailHtml(brand_name, steps[2]?.headline, steps[2]?.body, steps[2]?.body2, steps[2]?.cta, imgPrompt, imgSeed)) : tmpl2;

  const emailMsg = (tmplId, step) => ({ from_email: 'hello@demo.com', reply_to_email: 'hello@demo.com', from_label: brand_name, subject_line: step?.subject ?? 'Hello', preview_text: step?.preview_text ?? '', cc_email: '', bcc_email: '', template_id: tmplId, smart_sending_enabled: false });

  const actions = [];
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const tmpl = i === 0 ? tmpl1 : i === 1 ? tmpl2 : tmpl3;
    const emailId = `e${i+1}`, delayId = `d${i+1}`, nextId = `e${i+2}`;
    const isLast = i === steps.length - 1;
    actions.push({ temporary_id: emailId, type: 'send-email', links: { next: isLast ? (include_conditional_split ? 'split' : null) : ((step.delay_hours ?? 0) > 0 ? delayId : nextId) }, data: { message: emailMsg(tmpl, step) } });
    if (!isLast && (step.delay_hours ?? 0) > 0) actions.push({ temporary_id: delayId, type: 'time-delay', links: { next: nextId }, data: { unit: 'hours', value: step.delay_hours } });
  }

  if (include_conditional_split) {
    actions.push({ temporary_id: 'split', type: 'conditional-split', links: { next_if_true: 'branch_yes', next_if_false: 'branch_no' }, data: { profile_filter: { condition_groups: [{ conditions: [{ type: 'profile-property', property: 'phone_number', filter: { type: 'existence', operator: 'is-set' } }] }] } } });
    if (includeSMSBranch && splitYes?.type === 'sms') {
      actions.push({ temporary_id: 'branch_yes', type: 'send-sms', links: { next: null }, data: { status: 'draft', message: { body: splitYes.body } } });
    } else {
      await client._rateLimit();
      const yesTmpl = splitYes ? await client.createTemplate(`${flowName} — Engaged`, buildEmailHtml(brand_name, splitYes.headline, splitYes.body, splitYes.body2, splitYes.cta, imgPrompt, imgSeed)) : tmpl3;
      actions.push({ temporary_id: 'branch_yes', type: 'send-email', links: { next: null }, data: { message: emailMsg(yesTmpl, splitYes) } });
    }
    await client._rateLimit();
    const noTmpl = splitNo ? await client.createTemplate(`${flowName} — Follow-up`, buildEmailHtml(brand_name, splitNo.headline, splitNo.body, splitNo.body2, splitNo.cta, imgPrompt, imgSeed)) : tmpl3;
    actions.push({ temporary_id: 'branch_no', type: 'send-email', links: { next: null }, data: { message: emailMsg(noTmpl, splitNo) } });
  }

  await client._rateLimit();
  const flowRes = await client._fetch('POST', '/flows/', { data: { type: 'flow', attributes: { name: flowName, definition: { triggers: [{ type: 'list', id: triggerList.id }], entry_action_id: 'e1', actions } } } }, '2024-10-15.pre');
  if (!flowRes.ok) {
    const err = await flowRes.json().catch(() => ({}));
    throw new Error(`Flow creation failed: ${(err.errors ?? []).map(e => e.detail).join(' | ')}`);
  }
  const flowData = await flowRes.json();
  return { content: [{ type: 'text', text: `Flow "${flowName}" created in Klaviyo (ID: ${flowData.data?.id}).` }] };
});

// ── sandbox_status ────────────────────────────────────────────────────────────
mcp.registerTool('sandbox_status', {
  description: 'Return a summary of lists and seeded profiles in the Klaviyo account.',
  inputSchema: {
    api_key: z.string().optional().describe('Klaviyo private API key — omit to use KLAVIYO_API_KEY from .env'),
  },
}, async ({ api_key }) => {
  const client = new KlaviyoClient(resolveKey(api_key));
  const summary = await client.getSandboxSummary();
  return { content: [{ type: 'text', text: summary }] };
});

// ── Connect stdio transport ───────────────────────────────────────────────────
const transport = new StdioServerTransport();
await mcp.connect(transport);
