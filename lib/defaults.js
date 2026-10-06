// Store settings as first shipped. The admin panel saves overrides on top of these
// (settings table, key "site"); the storefront reads the merged result from /api/config.
// The shape of this object is also the validation schema for saves — see lib/settings.js.

export const DEFAULTS = {
  sku: "DIETSLIM-100G",
  productName: "Diet Slim Tea – Green Tea Herbal Blend 100 g",
  brand: "Diet Slim Tea",
  currency: "INR",
  // Pack cards on the page are fixed at 1, 2, 3 and 5 packs; only their prices are editable.
  packs: [
    { qty: 1, price: 399 },
    { qty: 2, price: 699 },
    { qty: 3, price: 899 },
    { qty: 5, price: 1299 }
  ],
  defaultPack: 3,
  maxQty: 20,
  shipping: { fee: 0, freeAbove: null },
  whatsapp: {
    number: "",
    message: "Hi, I want to order Diet Slim Tea. Please share the available offers."
  },
  text: {
    heroEyebrow: "Green Tea Herbal Blend · 100 g",
    heroTitle: "Meet Diet Slim Tea.",
    heroSubtitle: "Your Daily Wellness Tea Ritual.",
    heroLede: "A refreshing green tea herbal blend crafted for people who want a better everyday tea routine.",
    offersTitle: "Choose Your Diet Slim Tea Pack",
    offersSub: "Every pack is 100 g. Buy more, pay less per pack.",
    finalTitle: "Make Your Everyday Tea Better.",
    finalSub: "Try Diet Slim Tea today and build your own daily tea ritual.",
    footerAbout: "Your Daily Wellness Tea Ritual. A green tea herbal blend in 100 g packs."
  },
  faq: [
    { q: "What is Diet Slim Tea?", a: "Diet Slim Tea is a green tea herbal blend created as a refreshing beverage for your everyday wellness routine." },
    { q: "How much should I use?", a: "Use approximately 2 g per serving, or follow the preparation instructions on the final packaging." },
    { q: "Can I drink it every day?", a: "Diet Slim Tea is designed as an everyday beverage. Please follow the product label and consider your individual dietary needs." },
    { q: "Does Diet Slim Tea guarantee weight loss?", a: "No. Diet Slim Tea is a beverage and is not a guaranteed weight-loss treatment. A healthy lifestyle, nutrition and physical activity are important for weight management." },
    { q: "How should I store it?", a: "Keep it sealed and store in a cool, dry place." },
    { q: "Do you ship across India?", a: "Yes, we ship across India through our delivery partner. Delivery charges, if any, are shown at checkout." },
    { q: "What payment methods are available?", a: "UPI, credit and debit cards, net banking and wallets, through our secure payment gateway." }
  ],
  analytics: {
    gtmId: "",
    ga4Id: "",
    googleAdsId: "",
    googleAdsPurchaseLabel: "",
    metaPixelId: "",
    debug: false
  },
  product: { ingredientsLabel: null, manufacturer: null, fssai: null },
  contact: { legalName: null, whatsappDisplay: null, email: null, grievanceOfficer: null, address: null },
  links: { shipping: "", refund: "", privacy: "", terms: "" },
  reviews: [],

  // ---- private: never sent to the storefront ----
  fulfillment: {
    pickupLocation: "Primary",   // must match a pickup address name in Shiprocket → Settings → Pickup Addresses
    weightKgPerPack: 0.15,
    lengthCm: 20,
    breadthCm: 15,
    heightCm: 5,
    autoCreateShipment: false   // create the Shiprocket order automatically as soon as payment succeeds
  },
  notifications: {
    emailOnOrder: true,
    extraEmails: ""             // comma-separated, in addition to the admin email
  }
};

export const PRIVATE_KEYS = ["fulfillment", "notifications"];

// Array item shapes used to validate repeatable lists.
export const ITEM_SHAPES = {
  packs: { qty: 1, price: 1 },
  faq: { q: "", a: "" },
  reviews: { name: "", rating: 5, text: "", photo: "", verified: false }
};
