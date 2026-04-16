#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { KlaviyoClient } from './klaviyo.js';
import { DataGenerator } from './generator.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const klaviyo = new KlaviyoClient(config.klaviyo_api_key);
const generator = new DataGenerator(config);

const server = new Server(
  { name: 'klaviyo-sandbox-seeder', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'seed_sandbox',
      description: 'Seed a Klaviyo sandbox account end-to-end: creates profiles, lists, and historical events for a realistic DTC apparel brand demo.',
      inputSchema: {
        type: 'object',
        properties: {
          profile_count: {
            type: 'number',
            description: 'Number of customer profiles to create (default: 250)',
          },
          scenario: {
            type: 'string',
            enum: ['standard', 'growth', 'churn_risk'],
            description: 'Data scenario shape. standard = healthy mix, growth = lots of new customers, churn_risk = many lapsed customers',
          },
        },
      },
    },
    {
      name: 'seed_profiles',
      description: 'Create synthetic customer profiles only (no events).',
      inputSchema: {
        type: 'object',
        properties: {
          count: { type: 'number', description: 'Number of profiles (default: 100)' },
          segment: {
            type: 'string',
            enum: ['champions', 'loyal', 'at_risk', 'lapsed', 'new', 'mixed'],
            description: 'RFM segment to populate (default: mixed)',
          },
        },
      },
    },
    {
      name: 'seed_events',
      description: 'Track historical purchase and browse events for existing profiles.',
      inputSchema: {
        type: 'object',
        properties: {
          event_type: {
            type: 'string',
            enum: ['Placed Order', 'Viewed Product', 'Started Checkout', 'Fulfilled Order', 'Cancelled Order'],
          },
          days_back: { type: 'number', description: 'How far back to generate events (default: 180)' },
        },
      },
    },
    {
      name: 'create_lists',
      description: 'Create the standard DTC apparel segment lists in Klaviyo.',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'reset_sandbox',
      description: 'Delete all profiles created by this seeder to start fresh. Requires confirm: true.',
      inputSchema: {
        type: 'object',
        required: ['confirm'],
        properties: {
          confirm: { type: 'boolean', description: 'Must be true to proceed' },
        },
      },
    },
    {
      name: 'describe_sandbox',
      description: 'Returns a summary of what data exists in the connected Klaviyo account.',
      inputSchema: { type: 'object', properties: {} },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'seed_sandbox': {
        const count = args?.profile_count ?? 250;
        const scenario = args?.scenario ?? 'standard';
        const result = await runFullSeed(count, scenario);
        return { content: [{ type: 'text', text: result }] };
      }

      case 'seed_profiles': {
        const count = args?.count ?? 100;
        const segment = args?.segment ?? 'mixed';
        const profiles = generator.generateProfiles(count, segment);
        const created = await klaviyo.upsertProfiles(profiles);
        return { content: [{ type: 'text', text: `✓ Created ${created} profiles (segment: ${segment})` }] };
      }

      case 'seed_events': {
        const eventType = args?.event_type ?? 'Placed Order';
        const daysBack = args?.days_back ?? 180;
        const profileIds = await klaviyo.getAllSeededProfileIds();
        const events = generator.generateEvents(profileIds, eventType, daysBack);
        const tracked = await klaviyo.trackEvents(events);
        return { content: [{ type: 'text', text: `✓ Tracked ${tracked} "${eventType}" events over ${daysBack} days` }] };
      }

      case 'create_lists': {
        const lists = await klaviyo.createStandardLists();
        return { content: [{ type: 'text', text: `✓ Created lists: ${lists.join(', ')}` }] };
      }

      case 'reset_sandbox': {
        if (!args?.confirm) return { content: [{ type: 'text', text: 'Aborted. Pass confirm: true to reset.' }] };
        const deleted = await klaviyo.deleteSeededProfiles();
        return { content: [{ type: 'text', text: `✓ Deleted ${deleted} seeded profiles. Account is clean.` }] };
      }

      case 'describe_sandbox': {
        const summary = await klaviyo.getSandboxSummary();
        return { content: [{ type: 'text', text: summary }] };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (err) {
    return { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true };
  }
});

async function runFullSeed(count, scenario) {
  const lines = [];
  log(`Starting full seed: ${count} profiles, scenario="${scenario}"`);

  // 1. Lists
  const lists = await klaviyo.createStandardLists();
  lines.push(`✓ Lists created: ${lists.join(', ')}`);

  // 2. Profiles with RFM distribution based on scenario
  const dist = SCENARIO_DISTRIBUTIONS[scenario];
  const segments = Object.entries(dist).map(([seg, pct]) => ({
    seg, count: Math.round(count * pct),
  }));

  let totalProfiles = 0;
  for (const { seg, count: segCount } of segments) {
    const profiles = generator.generateProfiles(segCount, seg);
    const created = await klaviyo.upsertProfiles(profiles, seg);
    totalProfiles += created;
    lines.push(`  ✓ ${seg}: ${created} profiles`);
  }
  lines.push(`✓ ${totalProfiles} total profiles`);

  // 3. Events
  const profileIds = await klaviyo.getAllSeededProfileIds();
  for (const eventType of ['Placed Order', 'Fulfilled Order', 'Viewed Product', 'Started Checkout']) {
    const events = generator.generateEvents(profileIds, eventType, 365);
    const tracked = await klaviyo.trackEvents(events);
    lines.push(`✓ ${tracked} "${eventType}" events`);
  }

  lines.push('');
  lines.push('Sandbox ready. Connect Claude Desktop and start demoing.');
  return lines.join('\n');
}

const SCENARIO_DISTRIBUTIONS = {
  standard:   { champions: 0.10, loyal: 0.20, at_risk: 0.20, lapsed: 0.25, new: 0.25 },
  growth:     { champions: 0.05, loyal: 0.10, at_risk: 0.10, lapsed: 0.15, new: 0.60 },
  churn_risk: { champions: 0.05, loyal: 0.10, at_risk: 0.35, lapsed: 0.40, new: 0.10 },
};

function log(msg) { process.stderr.write(`[seeder] ${msg}\n`); }

const transport = new StdioServerTransport();
await server.connect(transport);
