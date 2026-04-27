// prisma/seed-card-hero.ts
// Seeds 9 Bell-Italia-style card hero slide items into NigiTriple SiteSetting.
// Every 3 cards form one slide — so 9 cards = 3 slides.
//
// Usage:
//   npx ts-node --project prisma/tsconfig.json prisma/seed-card-hero.ts

import prisma from "../src/config/database";

const CARD_HERO_SLIDES = [
  // ── Slide 1 (cards 1–3) ────────────────────────────────────────────────────
  {
    id: "card-hero-1",
    heading: "7,000+ Products in our Assortment",
    paragraph:
      "NigiTriple is always up-to-date with the most popular Nigerian FMCG products — both food and non-food — at the best prices in Port Harcourt. Order over 7,000 different products from us.",
    buttonText: "Shop Now",
    buttonUrl: "/products",
    image: "", // Add your Cloudinary URL here
  },
  {
    id: "card-hero-2",
    heading: "Visit Our Store in Port Harcourt",
    paragraph:
      "We invite you to visit us in Port Harcourt, Rivers State. Come get to know us and the quality products we carry — and see for yourself why thousands of families trust NigiTriple.",
    buttonText: "Get Directions",
    buttonUrl: "/contact",
    image: "", // Add your Cloudinary URL here
  },
  {
    id: "card-hero-3",
    heading: "100% Authentic Nigerian Products",
    paragraph:
      "We propose all the food and non-food products available in Nigerian supermarkets. We guarantee the authenticity of every item and do our part in the fight against counterfeit goods.",
    buttonText: "Learn More",
    buttonUrl: "/about",
    image: "", // Add your Cloudinary URL here
  },

  // ── Slide 2 (cards 4–6) ────────────────────────────────────────────────────
  {
    id: "card-hero-4",
    heading: "NAFDAC-Certified Products",
    paragraph:
      "Every product on our shelves carries its NAFDAC registration number. Shop with confidence knowing that all items meet Nigerian food safety and regulatory standards.",
    buttonText: "Browse Products",
    buttonUrl: "/products",
    image: "", // Add your Cloudinary URL here
  },
  {
    id: "card-hero-5",
    heading: "Fast Delivery Across Nigeria",
    paragraph:
      "We deliver to all 36 states in Nigeria. From Port Harcourt to Lagos, Abuja to Kano — your groceries arrive fresh and on time, with real-time order tracking.",
    buttonText: "Check Shipping",
    buttonUrl: "/contact",
    image: "", // Add your Cloudinary URL here
  },
  {
    id: "card-hero-6",
    heading: "Weekly Promotions & Deals",
    paragraph:
      "Don't miss our Promotions of the Week — hand-picked discounts on your favourite Nigerian food brands, household essentials, and personal care products. New deals every Monday.",
    buttonText: "See Promotions",
    buttonUrl: "/products?isOnPromotion=true",
    image: "", // Add your Cloudinary URL here
  },

  // ── Slide 3 (cards 7–9) ────────────────────────────────────────────────────
  {
    id: "card-hero-7",
    heading: "Halal & Organic Selections",
    paragraph:
      "We carry a curated range of Halal-certified, organic, and gluten-free products so that every Nigerian family can shop according to their dietary values and health needs.",
    buttonText: "Shop Halal",
    buttonUrl: "/products",
    image: "", // Add your Cloudinary URL here
  },
  {
    id: "card-hero-8",
    heading: "In-Store POS & Pickup",
    paragraph:
      "Order online and pick up from our Port Harcourt store — no delivery wait, no extra charge. Our POS system means you can also walk in and shop the full range in person.",
    buttonText: "Learn More",
    buttonUrl: "/about",
    image: "", // Add your Cloudinary URL here
  },
  {
    id: "card-hero-9",
    heading: "Earn Rewards on Every Order",
    paragraph:
      "Join thousands of NigiTriple customers enjoying exclusive VIP discounts, early access to promotions, and reward points on every purchase — online or in-store.",
    buttonText: "Create Account",
    buttonUrl: "/register",
    image: "", // Add your Cloudinary URL here
  },
];

async function main() {
  console.log("🌱 Seeding card hero slides...");

  // Get or create site settings
  let settings = await prisma.siteSetting.findFirst();
  if (!settings) {
    settings = await prisma.siteSetting.create({ data: {} });
    console.log("✅ Created new SiteSetting document");
  }

  await prisma.siteSetting.update({
    where: { id: settings.id },
    data: {
      cardHeroSlides: CARD_HERO_SLIDES as any[],
      // Uncomment the line below to switch the homepage to card hero mode:
      // heroDisplayType: "card",
    },
  });

  console.log(
    `✅ Seeded ${CARD_HERO_SLIDES.length} card hero items (${CARD_HERO_SLIDES.length / 3} slides of 3 cards each)`,
  );
  console.log("");
  console.log("📝 Next steps:");
  console.log(
    "   1. Add image URLs to each card (upload to Cloudinary, paste the URL into the seed or admin panel)",
  );
  console.log(
    '   2. To activate card hero on the homepage, set heroDisplayType to "card" or "both" in the admin',
  );
  console.log(
    "      → Admin → Settings → Pages → Homepage Settings → Card Hero Slides → Hero Display Mode",
  );
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
