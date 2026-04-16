// generator.js — synthetic DTC apparel data
// Produces realistic customer profiles + event histories with proper RFM distributions

const FIRST_NAMES = [
  'Ava','Mia','Zoe','Lily','Emma','Chloe','Nora','Aria','Luna','Sofia',
  'Maya','Isla','Ella','Grace','Hazel','Riley','Scarlett','Violet','Penelope','Aurora',
  'James','Liam','Noah','Ethan','Mason','Logan','Lucas','Aiden','Jackson','Sebastian',
  'Oliver','Elijah','Carter','Owen','Wyatt','Leo','Julian','Hudson','Theo','Felix',
  'Jordan','Morgan','Avery','Quinn','Sage','River','Finley','Blake','Casey','Drew',
];

const LAST_NAMES = [
  'Chen','Park','Kim','Nguyen','Patel','Garcia','Rodriguez','Martinez','Thompson','Wilson',
  'Anderson','Taylor','Moore','Jackson','White','Harris','Clark','Lewis','Walker','Hall',
  'Allen','Young','King','Wright','Scott','Green','Baker','Adams','Nelson','Carter',
  'Mitchell','Perez','Roberts','Turner','Phillips','Campbell','Parker','Evans','Edwards','Collins',
];

const EMAIL_DOMAINS = ['gmail.com','yahoo.com','icloud.com','outlook.com','hotmail.com','me.com'];

const LOCATIONS = [
  { city: 'New York',      region: 'NY', zip: '10001', country: 'US' },
  { city: 'Los Angeles',   region: 'CA', zip: '90001', country: 'US' },
  { city: 'Chicago',       region: 'IL', zip: '60601', country: 'US' },
  { city: 'Houston',       region: 'TX', zip: '77001', country: 'US' },
  { city: 'Phoenix',       region: 'AZ', zip: '85001', country: 'US' },
  { city: 'Philadelphia',  region: 'PA', zip: '19101', country: 'US' },
  { city: 'San Antonio',   region: 'TX', zip: '78201', country: 'US' },
  { city: 'San Diego',     region: 'CA', zip: '92101', country: 'US' },
  { city: 'Dallas',        region: 'TX', zip: '75201', country: 'US' },
  { city: 'San Jose',      region: 'CA', zip: '95101', country: 'US' },
  { city: 'Austin',        region: 'TX', zip: '73301', country: 'US' },
  { city: 'Jacksonville',  region: 'FL', zip: '32099', country: 'US' },
  { city: 'Fort Worth',    region: 'TX', zip: '76101', country: 'US' },
  { city: 'Columbus',      region: 'OH', zip: '43085', country: 'US' },
  { city: 'Charlotte',     region: 'NC', zip: '28201', country: 'US' },
  { city: 'Indianapolis',  region: 'IN', zip: '46201', country: 'US' },
  { city: 'San Francisco', region: 'CA', zip: '94101', country: 'US' },
  { city: 'Seattle',       region: 'WA', zip: '98101', country: 'US' },
  { city: 'Denver',        region: 'CO', zip: '80201', country: 'US' },
  { city: 'Nashville',     region: 'TN', zip: '37201', country: 'US' },
  { city: 'Portland',      region: 'OR', zip: '97201', country: 'US' },
  { city: 'Atlanta',       region: 'GA', zip: '30301', country: 'US' },
  { city: 'Miami',         region: 'FL', zip: '33101', country: 'US' },
  { city: 'Minneapolis',   region: 'MN', zip: '55401', country: 'US' },
  { city: 'Boston',        region: 'MA', zip: '02101', country: 'US' },
];

const PRODUCTS = [
  { id: 'P001', name: 'Classic Crewneck Sweatshirt', category: 'Tops', price: 89 },
  { id: 'P002', name: 'Slim Fit Chinos', category: 'Bottoms', price: 115 },
  { id: 'P003', name: 'Relaxed Linen Shirt', category: 'Tops', price: 95 },
  { id: 'P004', name: 'High-Rise Wide Leg Jeans', category: 'Bottoms', price: 135 },
  { id: 'P005', name: 'Oversized Blazer', category: 'Outerwear', price: 220 },
  { id: 'P006', name: 'Ribbed Tank Top', category: 'Tops', price: 45 },
  { id: 'P007', name: 'Cargo Trousers', category: 'Bottoms', price: 125 },
  { id: 'P008', name: 'Puffer Vest', category: 'Outerwear', price: 165 },
  { id: 'P009', name: 'Knit Midi Dress', category: 'Dresses', price: 155 },
  { id: 'P010', name: 'Essential Tee 3-Pack', category: 'Tops', price: 65 },
  { id: 'P011', name: 'Leather Belt', category: 'Accessories', price: 55 },
  { id: 'P012', name: 'Canvas Tote Bag', category: 'Accessories', price: 40 },
  { id: 'P013', name: 'Wool Scarf', category: 'Accessories', price: 75 },
  { id: 'P014', name: 'Structured Trench Coat', category: 'Outerwear', price: 340 },
  { id: 'P015', name: 'Seamless Leggings', category: 'Activewear', price: 85 },
];

const LISTS = {
  champions:  'VIP Champions',
  loyal:      'Loyal Customers',
  at_risk:    'At-Risk Customers',
  lapsed:     'Lapsed 90+ Days',
  new:        'New Customers',
  newsletter: 'Newsletter Subscribers',
  sale:       'Sale Interested',
};

// RFM config per segment: days since last order, order count, avg order value
const SEGMENT_CONFIG = {
  champions:  { recency: [1, 30],   frequency: [5, 15],  aov: [180, 380], subscribed: true  },
  loyal:      { recency: [15, 60],  frequency: [3, 8],   aov: [120, 250], subscribed: true  },
  at_risk:    { recency: [61, 120], frequency: [2, 5],   aov: [90, 200],  subscribed: true  },
  lapsed:     { recency: [121, 365],frequency: [1, 3],   aov: [70, 160],  subscribed: false },
  new:        { recency: [1, 45],   frequency: [1, 2],   aov: [60, 160],  subscribed: true  },
};

export class DataGenerator {
  constructor(config) {
    this.config = config;
    this._usedEmails = new Set();
  }

  generateProfiles(count, segment = 'mixed') {
    const profiles = [];
    const segments = segment === 'mixed'
      ? ['champions','loyal','at_risk','lapsed','new']
      : [segment];

    for (let i = 0; i < count; i++) {
      const seg = segments[i % segments.length];
      profiles.push(this._makeProfile(seg));
    }
    return profiles;
  }

  _makeProfile(segment) {
    const cfg = SEGMENT_CONFIG[segment] ?? SEGMENT_CONFIG.loyal;
    const firstName = pick(FIRST_NAMES);
    const lastName = pick(LAST_NAMES);
    const email = this._uniqueEmail(firstName, lastName);
    const orderCount = randInt(...cfg.frequency);
    const aov = randFloat(...cfg.aov);
    const totalSpent = +(aov * orderCount).toFixed(2);
    const lastOrderDaysAgo = randInt(...cfg.recency);
    const lastOrderDate = daysAgo(lastOrderDaysAgo).toISOString();

    return {
      email,
      first_name: firstName,
      last_name: lastName,
      phone_number: Math.random() > 0.4 ? randomPhone() : undefined,
      location: pick(LOCATIONS),
      subscribed: cfg.subscribed,
      properties: {
        rfm_segment:     segment,
        total_spent:     totalSpent,
        order_count:     orderCount,
        average_order_value: +aov.toFixed(2),
        last_order_date: lastOrderDate,
        days_since_last_order: lastOrderDaysAgo,
        preferred_category: pick(['Tops','Bottoms','Outerwear','Dresses','Accessories']),
        acquisition_source: pick(['organic','paid_social','google','referral','email']),
        // seeder tag so reset_sandbox knows what to delete
        _seeder: true,
      },
    };
  }

  generateEvents(profileIds, eventType, daysBack = 180, maxPerProfile = Infinity) {
    const events = [];

    for (const profileId of profileIds) {
      const eventCount = Math.min(this._eventCountForType(eventType), maxPerProfile);
      for (let i = 0; i < eventCount; i++) {
        const eventDate = randomDateWithin(daysBack);
        const product = pick(PRODUCTS);
        const qty = eventType === 'Placed Order' ? randInt(1, 3) : 1;
        const value = +(product.price * qty).toFixed(2);

        events.push({
          profileId,
          eventType,
          time: eventDate.toISOString(),
          value,
          properties: this._eventProps(eventType, product, qty, value),
        });
      }
    }

    return events;
  }

  _eventCountForType(eventType) {
    const counts = {
      'Placed Order':      [1, 6],
      'Fulfilled Order':   [1, 6],
      'Viewed Product':    [3, 18],
      'Started Checkout':  [1, 4],
      'Cancelled Order':   [0, 1],
    };
    const range = counts[eventType] ?? [1, 3];
    return randInt(...range);
  }

  _eventProps(eventType, product, qty, value) {
    const base = {
      product_id:   product.id,
      product_name: product.name,
      category:     product.category,
      price:        product.price,
    };

    if (eventType === 'Placed Order' || eventType === 'Fulfilled Order') {
      return {
        ...base,
        order_id:     `ORD-${randomHex(8).toUpperCase()}`,
        quantity:     qty,
        value,
        items: [{ id: product.id, name: product.name, quantity: qty, price: product.price }],
        brand: 'Arc & Thread',   // fictional brand name for the demo
        currency: 'USD',
      };
    }
    return base;
  }

  _uniqueEmail(first, last) {
    const domain = pick(EMAIL_DOMAINS);
    const variants = [
      `${first.toLowerCase()}.${last.toLowerCase()}`,
      `${first.toLowerCase()}${last.toLowerCase()}`,
      `${first.toLowerCase()}${randInt(10,99)}`,
      `${first[0].toLowerCase()}${last.toLowerCase()}${randInt(1,999)}`,
    ];
    for (const v of variants) {
      const email = `${v}@${domain}`;
      if (!this._usedEmails.has(email)) {
        this._usedEmails.add(email);
        return email;
      }
    }
    // guaranteed unique fallback
    const fallback = `user${Date.now()}${randInt(1000,9999)}@${domain}`;
    this._usedEmails.add(fallback);
    return fallback;
  }
}

// ── Helpers ────────────────────────────────────────────
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function randInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function randFloat(min, max) { return Math.random() * (max - min) + min; }
function daysAgo(n) { const d = new Date(); d.setDate(d.getDate() - n); return d; }
function randomDateWithin(days) { return daysAgo(randInt(0, days)); }
function randomPhone() { return `+1${randInt(200,999)}${randInt(100,999)}${randInt(1000,9999)}`; }
function randomHex(n) { return [...Array(n)].map(() => Math.floor(Math.random()*16).toString(16)).join(''); }

export { LISTS, PRODUCTS };
