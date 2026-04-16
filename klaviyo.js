// klaviyo.js — Klaviyo REST API v3 client
// Handles rate limiting, retries, and all seeder API calls

const BASE = 'https://a.klaviyo.com/api';
const REVISION = '2024-10-15';
const RATE_LIMIT_DELAY_MS = 1100; // ~55 req/min, safely under the 60/min free-tier limit

// Hidden tracking list — every seeded profile is added here so reset can find them
// without relying on custom-property filtering, which Klaviyo doesn't support server-side.
const SEEDER_LIST_NAME = '__Seeder';

const STANDARD_LISTS = [
  'VIP Champions',
  'Loyal Customers',
  'At-Risk Customers',
  'Lapsed 90+ Days',
  'New Customers',
  'Newsletter Subscribers',
  'Sale Interested',
  'Abandoned Checkout',
  'Post-Purchase Sequence',
];

export class KlaviyoClient {
  constructor(apiKey) {
    if (!apiKey) throw new Error('KLAVIYO_API_KEY is required');
    this.apiKey = apiKey;
    this._headers = {
      'Authorization': `Klaviyo-API-Key ${apiKey}`,
      'revision': REVISION,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };
    this._seededProfileIds = [];
    this._listCache = {};
  }

  // ── Profiles ──────────────────────────────────────────

  async upsertProfiles(profiles, segment) {
    let created = 0;
    for (const p of profiles) {
      await this._rateLimit();
      const id = await this._upsertProfile(p);
      if (id) {
        this._seededProfileIds.push(id);
        // Always add to the seeder tracking list so reset can find this profile
        if (this._listCache[SEEDER_LIST_NAME]) {
          await this._rateLimit();
          await this._addToList(this._listCache[SEEDER_LIST_NAME], [id]);
        }
        const listName = this._segmentToListName(segment ?? p.properties?.rfm_segment);
        if (listName && this._listCache[listName]) {
          await this._rateLimit();
          await this._addToList(this._listCache[listName], [id]);
        }
        created++;
      }
    }
    return created;
  }

  async _upsertProfile(profile) {
    const body = {
      data: {
        type: 'profile',
        attributes: {
          email: profile.email,
          first_name: profile.first_name,
          last_name: profile.last_name,
          ...(profile.phone_number ? { phone_number: profile.phone_number } : {}),
          ...(profile.location ? { location: profile.location } : {}),
          properties: profile.properties,
        },
      },
    };

    const res = await this._fetch('POST', '/profiles/', body);

    if (res.status === 409) {
      const data = await res.json();
      return data?.errors?.[0]?.meta?.duplicate_profile_id ?? null;
    }

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`Profile upsert failed: ${JSON.stringify(err)}`);
    }

    const data = await res.json();
    return data?.data?.id ?? null;
  }

  async getAllSeededProfileIds() {
    if (this._seededProfileIds.length > 0) return this._seededProfileIds;

    // Primary: look up the __Seeder tracking list and return its members.
    // This is reliable because we add every profile to this list during seeding.
    const lists = await this._getLists();
    const seederList = lists.find(l => l.name === SEEDER_LIST_NAME);
    console.log(`[reset] found ${lists.length} lists; seeder list: ${seederList ? seederList.id : 'none'}`);

    if (seederList) {
      const ids = await this._getListProfileIds(seederList.id);
      console.log(`[reset] seeder list has ${ids.length} profiles`);
      this._seededProfileIds = ids;
      return ids;
    }

    // Fallback: paginate all profiles and filter on _seeder property.
    // Requires fields[profile]=properties so Klaviyo includes custom props.
    console.log('[reset] no seeder list found — falling back to property scan');
    const ids = [];
    let cursor = null;
    do {
      await this._rateLimit();
      const qs = cursor
        ? `?page[size]=100&fields[profile]=properties&page[cursor]=${cursor}`
        : `?page[size]=100&fields[profile]=properties`;
      const res = await this._fetch('GET', `/profiles/${qs}`);
      const data = await res.json();
      for (const p of data?.data ?? []) {
        const seeder = p.attributes?.properties?._seeder;
        if (seeder === true || seeder === 'true') ids.push(p.id);
      }
      cursor = data?.links?.next
        ? new URL(data.links.next).searchParams.get('page[cursor]')
        : null;
    } while (cursor);
    console.log(`[reset] property scan found ${ids.length} profiles`);

    this._seededProfileIds = ids;
    return ids;
  }

  async _getListProfileIds(listId) {
    const ids = [];
    let cursor = null;
    do {
      await this._rateLimit();
      const qs = cursor
        ? `?page[size]=100&page[cursor]=${cursor}`
        : `?page[size]=100`;
      const res = await this._fetch('GET', `/lists/${listId}/relationships/profiles/${qs}`);
      const data = await res.json();
      for (const item of data?.data ?? []) ids.push(item.id);
      cursor = data?.links?.next
        ? new URL(data.links.next).searchParams.get('page[cursor]')
        : null;
    } while (cursor);
    return ids;
  }

  async deleteSeededProfiles() {
    const ids = await this.getAllSeededProfileIds();
    if (ids.length === 0) return 0;

    // DELETE /profiles/{id}/ returns 405 on Klaviyo trial accounts.
    // data-privacy-deletion-jobs is the documented deletion path for all plans.
    let submitted = 0;
    for (const id of ids) {
      await this._rateLimit();
      const res = await this._fetch('POST', '/data-privacy-deletion-jobs/', {
        data: {
          type: 'data-privacy-deletion-job',
          attributes: {
            profile: { data: { type: 'profile', id } },
          },
        },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(`Profile deletion failed (${res.status}): ${JSON.stringify(err)}`);
      }
      submitted++;
    }

    this._seededProfileIds = [];
    return submitted;
  }

  async deleteSeededLists() {
    const allLists = await this._getLists();
    const toDelete = allLists.filter(
      l => l.name === SEEDER_LIST_NAME || STANDARD_LISTS.includes(l.name)
    );
    let deleted = 0;
    for (const list of toDelete) {
      await this._rateLimit();
      const res = await this._fetch('DELETE', `/lists/${list.id}/`);
      if (res.ok || res.status === 404) deleted++;
    }
    return deleted;
  }

  // ── Lists ─────────────────────────────────────────────

  async createStandardLists() {
    // Create the hidden seeder tracking list first
    await this._rateLimit();
    const seederId = await this._createList(SEEDER_LIST_NAME);
    if (seederId) this._listCache[SEEDER_LIST_NAME] = seederId;

    const created = [];
    for (const name of STANDARD_LISTS) {
      await this._rateLimit();
      const id = await this._createList(name);
      if (id) {
        this._listCache[name] = id;
        created.push(name);
      }
    }
    return created;
  }

  async _createList(name) {
    const res = await this._fetch('POST', '/lists/', {
      data: { type: 'list', attributes: { name } },
    });
    if (res.status === 409) {
      const lists = await this._getLists();
      return lists.find(l => l.name === name)?.id ?? null;
    }
    const data = await res.json();
    return data?.data?.id ?? null;
  }

  async _getLists() {
    const res = await this._fetch('GET', '/lists/');
    const data = await res.json();
    return (data?.data ?? []).map(l => ({ id: l.id, name: l.attributes?.name }));
  }

  async _addToList(listId, profileIds) {
    await this._fetch('POST', `/lists/${listId}/relationships/profiles/`, {
      data: profileIds.map(id => ({ type: 'profile', id })),
    });
  }

  // ── Events ────────────────────────────────────────────

  async trackEvents(events) {
    let tracked = 0;
    for (const event of events) {
      await this._rateLimit();
      const ok = await this._trackEvent(event);
      if (ok) tracked++;
    }
    return tracked;
  }

  async _trackEvent(event) {
    const body = {
      data: {
        type: 'event',
        attributes: {
          metric: { data: { type: 'metric', attributes: { name: event.eventType } } },
          profile: { data: { type: 'profile', id: event.profileId } },
          time: event.time,
          value: event.value,
          properties: event.properties,
          unique_id: `${event.profileId}-${event.eventType}-${event.time}`,
        },
      },
    };
    const res = await this._fetch('POST', '/events/', body);
    return res.ok;
  }

  // ── Summary ───────────────────────────────────────────

  async getSandboxSummary() {
    const lists = await this._getLists();
    const lines = [
      `Klaviyo Sandbox Summary`,
      `─────────────────────────`,
      `Lists (${lists.length}): ${lists.map(l => l.name).join(', ') || 'none'}`,
      `Seeded this session: ${this._seededProfileIds.length} profiles`,
    ];
    return lines.join('\n');
  }

  // ── Core fetch + rate limit ───────────────────────────

  async _fetch(method, path, body, overrideRevision) {
    const headers = overrideRevision
      ? { ...this._headers, revision: overrideRevision }
      : this._headers;

    const res = await fetch(`${BASE}${path}`, {
      method,
      headers,
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

    if (res.status === 429) {
      const retryAfter = parseInt(res.headers.get('Retry-After') ?? '5', 10);
      await new Promise(r => setTimeout(r, retryAfter * 1000));
      return this._fetch(method, path, body, overrideRevision);
    }

    return res;
  }

  _rateLimit() {
    return new Promise(r => setTimeout(r, RATE_LIMIT_DELAY_MS));
  }

  _segmentToListName(segment) {
    const map = {
      champions: 'VIP Champions',
      loyal:     'Loyal Customers',
      at_risk:   'At-Risk Customers',
      lapsed:    'Lapsed 90+ Days',
      new:       'New Customers',
    };
    return map[segment] ?? null;
  }

  // ── Templates ─────────────────────────────────────────

  async createTemplate(name, html) {
    const res = await this._fetch('POST', '/templates/', {
      data: {
        type: 'template',
        attributes: {
          name,
          editor_type: 'CODE',
          html,
        },
      },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`createTemplate failed: ${JSON.stringify(err)}`);
    }
    const data = await res.json();
    return data.data.id;
  }

  // ── Campaigns (stable revision) ───────────────────────

  async createCampaign(attributes) {
    const res = await this._fetch('POST', '/campaigns/', {
      data: { type: 'campaign', attributes },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`createCampaign failed: ${JSON.stringify(err)}`);
    }
    const data = await res.json();
    const campaignId = data.data.id;
    // The API returns the created campaign-message IDs in the relationships block
    const messageId = data.data.relationships?.['campaign-messages']?.data?.[0]?.id ?? null;
    return { campaignId, messageId };
  }

  async assignTemplateToMessage(messageId, templateId) {
    const res = await this._fetch('POST', '/campaign-message-assign-template/', {
      data: {
        type: 'campaign-message',
        id: messageId,
        relationships: {
          template: { data: { type: 'template', id: templateId } },
        },
      },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`assignTemplateToMessage failed: ${JSON.stringify(err)}`);
    }
  }

  async createCampaignMessage(campaignId, attributes) {
    const res = await this._fetch('POST', '/campaign-messages/', {
      data: {
        type: 'campaign-message',
        attributes,
        relationships: {
          campaign: { data: { type: 'campaign', id: campaignId } },
        },
      },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`createCampaignMessage failed: ${JSON.stringify(err)}`);
    }
    const data = await res.json();
    return data.data.id;
  }

  // ── Flows (beta revision: 2024-10-15.pre) ─────────────

  async createFlow(attributes) {
    const res = await this._fetch('POST', '/flows/', {
      data: { type: 'flow', attributes },
    }, '2024-10-15.pre');
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`createFlow [beta] failed: ${JSON.stringify(err)}`);
    }
    const data = await res.json();
    return data.data.id;
  }

  async createFlowAction(attributes) {
    const res = await this._fetch('POST', '/flow-actions/', {
      data: { type: 'flow-action', attributes },
    }, '2024-10-15.pre');
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      // Verbose on purpose — beta field names (parent_action_id, condition_branch)
      // may differ; the raw Klaviyo error shows exactly what was rejected.
      throw new Error(
        `createFlowAction [beta] failed — Klaviyo: ${JSON.stringify(err)}`
      );
    }
    const data = await res.json();
    return data.data.id;
  }
}
