/**
 * NigitTriple Settings Seed
 * Seeds all brand/site settings for NigitTriple Industry.
 *
 * Run: npx ts-node --project prisma/tsconfig.json prisma/seed-nigittriple-settings.ts
 *
 * This is safe to re-run — it upserts the single settings document.
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("⚙️  NigitTriple Settings Seed");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  // ── Upsert the single Settings doc ─────────────────────────────────────────
  // MongoDB uses the first record — find or create
  let settings = await prisma.siteSetting.findFirst();

  const nigitTripleSettings = {
    // ── Core Brand ────────────────────────────────────────────────────────────
    siteName: "NigitTriple Industry",
    siteDescription:
      "Premium grocery supermarket in Port Harcourt, Rivers State. Fresh food, beverages, household essentials and more — delivered fast.",
    siteKeywords:
      "grocery, supermarket, Port Harcourt, Rivers State, Nigeria, fresh food, beverages, NigitTriple, Italian products, imported goods",
    primaryColor: "#16a34a",
    secondaryColor: "#f59e0b",
    accentColor: "#374151",

    // ── Contact Information ───────────────────────────────────────────────────
    email: "info@nigittriple.com",
    phone: "+234 803 000 0000",
    address:
      "30 Abuloma Road (Bozgomero estate) Opposite FCMB Bank,   Port Harcourt, Rivers State, Nigeria",
    whatsapp: "+2348030000000",

    // ── Social Media ──────────────────────────────────────────────────────────
    facebook: "https://www.facebook.com/nigittriple",
    instagram: "https://www.instagram.com/nigittriple",
    twitter: "https://twitter.com/nigittriple",
    youtube: "",
    linkedin: "",

    // ── Business Settings ─────────────────────────────────────────────────────
    currency: "NGN",
    currencySymbol: "₦",
    taxRate: 0,

    // ── Email From ────────────────────────────────────────────────────────────
    emailFrom: "info@nigittriple.com",
    emailFromName: "NigitTriple Industry",

    // ── SEO ───────────────────────────────────────────────────────────────────
    metaTitle: "NigitTriple Industry — Grocery Supermarket, Port Harcourt",
    metaDescription:
      "Shop fresh groceries, imported Italian products, beverages, household essentials and more at NigitTriple Industry. Fast delivery across Port Harcourt, Rivers State.",

    // ── Store Info (POS & Pickup) ─────────────────────────────────────────────
    storeAddress: "30 Abuloma Road (Bozgomero estate) Opposite FCMB Bank",
    storeCity: "Port Harcourt",
    storeState: "Rivers",
    storeOpenHours: "Mon–Sat: 8am–9pm, Sun: 10am–7pm",
    storePhone: "+234 803 000 0000",

    // ── About Us Page ─────────────────────────────────────────────────────────
    aboutUsTitle: "About NigitTriple Industry",
    aboutUsContent: `
      <p>Welcome to <strong>NigitTriple Industry</strong> — Port Harcourt's premier grocery supermarket, 
      bringing you the finest selection of local and imported products under one roof.</p>

      <p>Founded with a mission to transform grocery shopping in Rivers State, NigitTriple Industry 
      stocks over 800 carefully curated products — from everyday Nigerian staples to premium Italian 
      imports, fine wines, beverages, snacks, household essentials, and much more.</p>

      <p>We believe every household deserves access to quality products at fair prices. That's why we 
      partner with trusted brands like Barilla, Garofalo, Loacker, Ferrero, Golden Penny, and hundreds 
      of others — sourced directly to guarantee authenticity and freshness.</p>

      <p>Whether you're shopping in-store or placing an order online for delivery across Port Harcourt, 
      NigitTriple Industry is committed to delivering an exceptional experience every time.</p>
    `,
    aboutUsMission:
      "To provide Port Harcourt households and businesses with reliable access to quality grocery products — from everyday Nigerian essentials to premium international imports — at competitive prices, with outstanding service.",
    aboutUsVision:
      "To be Rivers State's most trusted and preferred grocery destination, known for product quality, wide variety, and a seamless shopping experience both in-store and online.",
    aboutUsValues: [
      {
        title: "Quality First",
        description:
          "Every product on our shelves meets strict quality standards. We source from trusted suppliers and inspect every batch.",
        icon: "award",
      },
      {
        title: "Customer Focus",
        description:
          "Our customers are at the heart of everything we do. We listen, adapt, and go the extra mile to ensure satisfaction.",
        icon: "users",
      },
      {
        title: "Variety & Accessibility",
        description:
          "From imported Italian pasta to locally-made staples — we believe everyone deserves access to great products.",
        icon: "globe",
      },
      {
        title: "Freshness & Integrity",
        description:
          "We maintain strict NAFDAC compliance and expiry monitoring to ensure every product is safe and fresh.",
        icon: "check",
      },
      {
        title: "Community Growth",
        description:
          "We are proud to support local Nigerian producers and brands alongside our international selection.",
        icon: "trending",
      },
      {
        title: "Innovation",
        description:
          "From our online store to our in-store POS system, we embrace technology to make your shopping easier.",
        icon: "target",
      },
    ],
    aboutUsStats: [
      { label: "Products in Stock", value: "800+", icon: "check" },
      { label: "Trusted Brands", value: "200+", icon: "award" },
      { label: "Happy Customers", value: "5,000+", icon: "users" },
      { label: "Years in Business", value: "5+", icon: "trending" },
    ],
    aboutUsTeam: [],

    // ── Contact Page ──────────────────────────────────────────────────────────
    contactTitle: "Contact NigitTriple Industry",
    contactSubtitle:
      "We're here to help. Reach out for orders, inquiries, or feedback.",
    contactEmail: "info@nigittriple.com",
    contactPhone: "+234 803 000 0000",
    contactAddress: "Port Harcourt, Rivers State, Nigeria",
    contactWhatsapp: "+2348030000000",
    contactMap:
      "https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d126932.67!2d6.9!3d4.8!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x1069cd2f4fdf7f67%3A0x27e8c37a2ded7605!2sPort%20Harcourt%2C%20Rivers%20State!5e0!3m2!1sen!2sng!4v1617000000000",
    contactHours: {
      "Monday – Friday": "8:00am – 9:00pm",
      Saturday: "8:00am – 9:00pm",
      Sunday: "10:00am – 7:00pm",
      "Public Holidays": "10:00am – 6:00pm",
    },

    // ── Trust Badges ──────────────────────────────────────────────────────────
    trustBadges: [
      {
        title: "NAFDAC Compliant",
        description: "All food products meet NAFDAC standards",
        icon: "shield",
      },
      {
        title: "Fast Delivery",
        description: "Same-day delivery across Port Harcourt",
        icon: "truck",
      },
      {
        title: "Secure Payments",
        description: "Pay safely via Paystack or cash on delivery",
        icon: "lock",
      },
      {
        title: "Quality Guaranteed",
        description: "Fresh products with expiry date monitoring",
        icon: "check-circle",
      },
    ],
  };

  if (settings) {
    await prisma.siteSetting.update({
      where: { id: settings.id },
      data: nigitTripleSettings,
    });
    console.log(`✅ Settings updated (id: ${settings.id})`);
  } else {
    settings = await prisma.siteSetting.create({
      data: nigitTripleSettings,
    });
    console.log(`✅ Settings created (id: ${settings.id})`);
  }

  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("Brand settings seeded:");
  console.log(`  Site Name     : ${nigitTripleSettings.siteName}`);
  console.log(`  Email         : ${nigitTripleSettings.email}`);
  console.log(`  Phone         : ${nigitTripleSettings.phone}`);
  console.log(`  Address       : ${nigitTripleSettings.address}`);
  console.log(`  Contact Email : ${nigitTripleSettings.contactEmail}`);
  console.log(
    `  About Values  : ${nigitTripleSettings.aboutUsValues.length} values seeded`,
  );
  console.log(
    `  About Stats   : ${nigitTripleSettings.aboutUsStats.length} stats seeded`,
  );
  console.log(
    `  Trust Badges  : ${nigitTripleSettings.trustBadges.length} badges seeded`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
