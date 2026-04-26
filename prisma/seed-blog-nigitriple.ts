// backend/prisma/seed-blog-nigitriple.ts
// Generates 15 blog posts themed around NigitTriple's actual products
// and the Port Harcourt, Rivers State context.
//
// Run with:
//   npx ts-node --project prisma/tsconfig.json prisma/seed-blog-nigitriple.ts

import { PrismaClient, PostStatus } from "@prisma/client";

const prisma = new PrismaClient();

// ── Open-source images from Unsplash (free, no attribution required) ──────────
// All URLs are stable Unsplash source links that return high-quality images.
const IMAGES = {
  grocery:
    "https://images.unsplash.com/photo-1542838132-92c53300491e?w=1200&q=80",
  supermarket:
    "https://images.unsplash.com/photo-1534723452862-4c874018d66d?w=1200&q=80",
  beverages:
    "https://images.unsplash.com/photo-1563227812-0ea4c22e6cc8?w=1200&q=80",
  ovaltine:
    "https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?w=1200&q=80",
  sugar:
    "https://images.unsplash.com/photo-1584278860047-22db9ff82bed?w=1200&q=80",
  snacks:
    "https://images.unsplash.com/photo-1621939514649-280e2ee25f60?w=1200&q=80",
  cooking:
    "https://images.unsplash.com/photo-1556910103-1c02745aae4d?w=1200&q=80",
  family:
    "https://images.unsplash.com/photo-1586473219010-2ffc57b0d282?w=1200&q=80",
  market:
    "https://images.unsplash.com/photo-1488459716781-31db52582fe9?w=1200&q=80",
  health:
    "https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=1200&q=80",
  delivery:
    "https://images.unsplash.com/photo-1580674285054-bed31e145f59?w=1200&q=80",
  bread:
    "https://images.unsplash.com/photo-1509440159596-0249088772ff?w=1200&q=80",
  dairy:
    "https://images.unsplash.com/photo-1550583724-b2692b85b150?w=1200&q=80",
  savings:
    "https://images.unsplash.com/photo-1579621970563-ebec7560ff3e?w=1200&q=80",
  nigeria:
    "https://images.unsplash.com/photo-1607462109225-6b64ae2dd3cb?w=1200&q=80",
};

async function main() {
  console.log("🗑️  Clearing existing blog posts and categories…");
  await prisma.blogPost.deleteMany();
  await prisma.blogCategory.deleteMany();

  // ── Categories ──────────────────────────────────────────────────────────────
  console.log("📁 Creating blog categories…");

  const [lifestyle, tips, products, community, health] = await Promise.all([
    prisma.blogCategory.create({
      data: {
        name: "Lifestyle & Cooking",
        slug: "lifestyle-cooking",
        description:
          "Recipes, cooking tips and kitchen inspiration for Port Harcourt families",
      },
    }),
    prisma.blogCategory.create({
      data: {
        name: "Smart Shopping",
        slug: "smart-shopping",
        description:
          "Money-saving tips, deals and grocery hacks for Nigerian households",
      },
    }),
    prisma.blogCategory.create({
      data: {
        name: "Product Spotlights",
        slug: "product-spotlights",
        description: "Deep-dives into the brands and products on our shelves",
      },
    }),
    prisma.blogCategory.create({
      data: {
        name: "Community & PH Life",
        slug: "community-ph-life",
        description:
          "Stories, events and features from the Port Harcourt community",
      },
    }),
    prisma.blogCategory.create({
      data: {
        name: "Health & Nutrition",
        slug: "health-nutrition",
        description:
          "Nutritional guides and healthy eating advice for Nigerian families",
      },
    }),
  ]);

  console.log("✅ Categories created. Creating 15 blog posts…");

  const now = new Date();
  const daysAgo = (d: number) => new Date(now.getTime() - d * 86400000);

  const posts = [
    // ── 1 ──────────────────────────────────────────────────────────────────────
    {
      title: "5 Nigerian Breakfast Ideas Using Ovaltine Malted Drink",
      slug: "nigerian-breakfast-ideas-ovaltine",
      excerpt:
        "Start your day right in Port Harcourt with these five delicious breakfast combinations featuring Ovaltine — the nation's favourite malted drink.",
      content: `
<p>Port Harcourt mornings are busy — oil workers heading to the creeks, children off to school on Ada George Road, traders setting up early on Rumuola. A good breakfast is non-negotiable, and Ovaltine Malted Food Drink has been a fixture in Nigerian homes for generations.</p>

<h2>Why Ovaltine Works for Nigerian Families</h2>
<p>Ovaltine is fortified with 12 essential vitamins and minerals including Vitamin D and Iron — nutrients that are often lacking in typical diets. At just ₦4,600 for 400g at NigitTriple, it is one of the most cost-effective nutritional boosts available.</p>

<h2>5 Breakfast Ideas</h2>
<h3>1. Classic Ovaltine with Peak Milk</h3>
<p>Mix 25g of Ovaltine with warm water and two spoons of Peak Full Cream Milk Powder. This is the combination most Nigerians grew up with — rich, chocolatey and filling.</p>

<h3>2. Ovaltine Pap (Akamu) Combo</h3>
<p>Serve a bowl of freshly made akamu alongside a warm mug of Ovaltine. The pap provides energy through the morning while the Ovaltine tops up on vitamins.</p>

<h3>3. Cold Ovaltine Smoothie</h3>
<p>Blend Ovaltine with cold milk, a banana and ice cubes. A perfect quick breakfast for the Port Harcourt heat.</p>

<h3>4. Ovaltine Oatmeal</h3>
<p>Stir two teaspoons of Ovaltine into your morning oats before serving. It transforms plain oatmeal into a chocolatey, nutritious bowl your children will actually eat.</p>

<h3>5. Ovaltine French Toast Dip</h3>
<p>Make a thick mug of Ovaltine and use it as a dipping sauce for slices of toasted Butterfield bread. Indulgent, yes — but nutritious too.</p>

<h2>Get Yours at NigitTriple</h2>
<p>We stock Ovaltine 400g tins at our store. Shop online for delivery across Port Harcourt, Rumuola, Trans Amadi, GRA Phase 2 and beyond.</p>
      `.trim(),
      featuredImage: IMAGES.ovaltine,
      categoryId: lifestyle.id,
      tags: ["ovaltine", "breakfast", "port harcourt", "beverages", "family"],
      status: PostStatus.PUBLISHED,
      publishedAt: daysAgo(30),
    },

    // ── 2 ──────────────────────────────────────────────────────────────────────
    {
      title:
        "How to Save ₦10,000 Monthly on Your Grocery Bill in Port Harcourt",
      slug: "save-money-grocery-bill-port-harcourt",
      excerpt:
        "Practical strategies for Port Harcourt families to cut grocery costs without cutting corners on quality.",
      content: `
<p>With the cost of living rising across Nigeria, Port Harcourt households are feeling the pinch at the checkout counter. At NigitTriple, we believe good food should be accessible. Here are seven proven strategies to reduce your monthly grocery spend.</p>

<h2>1. Buy in Bulk for Staples</h2>
<p>Products like granulated sugar, cooking oil and rice are significantly cheaper per unit when bought in larger quantities. Our Sunola Granulated White Sugar 250g at ₦700 is a daily essential — buying in bulk when on promotion saves up to 20%.</p>

<h2>2. Plan Your Meals a Week Ahead</h2>
<p>Families in Port Harcourt who plan weekly menus report spending 30% less on food. Write your plan on Sunday, check what you already have, then shop with a focused list.</p>

<h2>3. Subscribe to Our Newsletter</h2>
<p>NigitTriple announces weekly deals and promotions exclusively to newsletter subscribers. Sign up at the bottom of this page and be the first to know about price drops.</p>

<h2>4. Shop the Promotions of the Week</h2>
<p>Our website has a dedicated "Promotions of the Week" section updated every Monday. These deals are time-limited, so check in regularly.</p>

<h2>5. Use Your Discount Codes</h2>
<p>At checkout, always check if you have a promo code. First-time customers often receive a welcome discount by email after registering.</p>

<h2>6. Avoid Shopping While Hungry</h2>
<p>Research consistently shows shoppers buy 20–40% more when hungry. Eat before you shop — even a quick snack at home helps.</p>

<h2>7. Choose Store Pickup to Save on Delivery</h2>
<p>If you live near our Port Harcourt store, choosing store pickup eliminates shipping costs entirely — useful for large, heavy grocery runs.</p>
      `.trim(),
      featuredImage: IMAGES.savings,
      categoryId: tips.id,
      tags: [
        "savings",
        "grocery tips",
        "port harcourt",
        "budgeting",
        "shopping",
      ],
      status: PostStatus.PUBLISHED,
      publishedAt: daysAgo(25),
    },

    // ── 3 ──────────────────────────────────────────────────────────────────────
    {
      title: "Golden Penny Sugar vs Sunola Sugar: Which Should You Buy?",
      slug: "golden-penny-vs-sunola-sugar-comparison",
      excerpt:
        "We compare two of the most popular sugar brands on our shelves to help you make the best choice for your household.",
      content: `
<p>Sugar is a grocery staple in every Nigerian home — from the tea each morning to the chin-chin at Christmas. At NigitTriple in Port Harcourt, we stock both Golden Penny White Cube Sugar and Sunola Granulated White Sugar. Here is how they compare.</p>

<h2>Sunola Granulated White Sugar 250g — ₦700</h2>
<p>Sunola is a Nigerian product, refined locally and designed for everyday use. The fine granules dissolve quickly in hot and cold drinks alike, making it ideal for tea, zobo, kunun zaki and baking. At ₦700 for 250g it is one of the most affordable options on our shelf.</p>

<p><strong>Best for:</strong> Everyday cooking, baking, large households on a budget, zobo and tigernut milk.</p>

<h2>Golden Penny White Cube Sugar 500g — ₦1,500</h2>
<p>Golden Penny cube sugar offers portioned convenience. Each cube is a consistent ~4g serving, making it ideal for serving guests at home or in offices. The 500g pack contains approximately 125 cubes.</p>

<p><strong>Best for:</strong> Serving tea or coffee to guests, office use, gift hampers, hotels and restaurants.</p>

<h2>Verdict</h2>
<p>For everyday household cooking, Sunola granulated wins on value. For entertaining guests or office settings, Golden Penny cubes offer better presentation and consistent portion control. Many households in Port Harcourt keep both.</p>

<p>Both are available for order on NigitTriple with delivery across Rivers State.</p>
      `.trim(),
      featuredImage: IMAGES.sugar,
      categoryId: products.id,
      tags: [
        "sugar",
        "golden penny",
        "sunola",
        "product comparison",
        "beverages",
      ],
      status: PostStatus.PUBLISHED,
      publishedAt: daysAgo(22),
    },

    // ── 4 ──────────────────────────────────────────────────────────────────────
    {
      title: "Port Harcourt's Growing Demand for International Grocery Brands",
      slug: "port-harcourt-international-grocery-brands",
      excerpt:
        "Why Port Harcourt shoppers are increasingly reaching for imported European and Asian food products — and where to find them.",
      content: `
<p>Port Harcourt has always been a cosmopolitan city. The oil and gas industry has brought workers and their families from across Nigeria and the world, creating demand for a diverse range of food products. At NigitTriple, we have seen this shift firsthand — and we have stocked accordingly.</p>

<h2>The Rise of Imported Snacks and Beverages</h2>
<p>Products like Salysol Pipas Peladas — premium Spanish shelled sunflower seeds packed in tins — have found a loyal following in Port Harcourt. Expat communities in GRA, Trans Amadi and Rumuola seek out these familiar tastes from home.</p>

<h2>European Quality at Nigerian Prices</h2>
<p>Ovaltine, originally a Swiss product now manufactured in the UK, is a prime example of how international quality has been localised for the Nigerian market. It is fortified to address common Nigerian dietary deficiencies.</p>

<h2>What This Means for Shoppers</h2>
<p>You no longer need to travel to the airport duty-free shop or pay premium prices at boutique import stores. NigitTriple brings these products to your doorstep at fair prices, with delivery across Port Harcourt and Rivers State.</p>

<h2>Browse Our International Selection</h2>
<p>Visit our website and filter by "Imported" to see the full range of international products currently in stock at our Port Harcourt supermarket.</p>
      `.trim(),
      featuredImage: IMAGES.supermarket,
      categoryId: community.id,
      tags: [
        "port harcourt",
        "imported foods",
        "international",
        "expat",
        "grocery",
      ],
      status: PostStatus.PUBLISHED,
      publishedAt: daysAgo(20),
    },

    // ── 5 ──────────────────────────────────────────────────────────────────────
    {
      title: "Understanding NAFDAC Numbers: Why They Matter When You Shop",
      slug: "nafdac-numbers-grocery-shopping-nigeria",
      excerpt:
        "Every registered food product in Nigeria has a NAFDAC number. Here is what it means and how to verify your groceries are safe.",
      content: `
<p>If you have ever looked at a food product in Nigeria and spotted a number starting with "A7-" or "04-", you have seen a NAFDAC registration number. Understanding what these numbers mean can help you shop safer for your family.</p>

<h2>What is NAFDAC?</h2>
<p>The National Agency for Food and Drug Administration and Control (NAFDAC) regulates and controls the manufacture, importation, exportation, distribution, advertisement, sale and use of food, drugs and other products in Nigeria.</p>

<h2>What the Registration Number Means</h2>
<p>A NAFDAC registration number confirms that a product has been tested and approved for sale in Nigeria. Products without this number — particularly food and beverages — are technically illegal for sale.</p>

<h2>How to Verify a NAFDAC Number</h2>
<p>You can verify any registration number on the official NAFDAC e-portal at nafdac.gov.ng. Simply enter the number from the product label to confirm its legitimacy.</p>

<h2>NigitTriple's Quality Commitment</h2>
<p>Every product on our shelves has passed our quality check process. We only stock products with valid NAFDAC numbers for food and beverages. This is a non-negotiable part of our responsibility to Port Harcourt families.</p>

<p>When you shop at NigitTriple — online or in-store — you can be confident that every item meets Nigerian regulatory standards.</p>
      `.trim(),
      featuredImage: IMAGES.health,
      categoryId: health.id,
      tags: ["nafdac", "food safety", "nigeria", "regulations", "health"],
      status: PostStatus.PUBLISHED,
      publishedAt: daysAgo(18),
    },

    // ── 6 ──────────────────────────────────────────────────────────────────────
    {
      title: "The Best Snacks to Keep at Your Port Harcourt Office Desk",
      slug: "best-office-desk-snacks-port-harcourt",
      excerpt:
        "Long days in the office or working from home in Port Harcourt? These snacks from NigitTriple will keep you energised without leaving your desk.",
      content: `
<p>Port Harcourt's work culture is intense — long meetings in Victoria Island-style offices in the GRA, late nights at oil and gas firms around Trans Amadi, and growing numbers of remote workers in Rumuola and Woji. Keeping good snacks at your desk is not just a luxury; it is a productivity strategy.</p>

<h2>Why Desk Snacking Matters</h2>
<p>Studies show that hunger leads to poor decision-making, reduced concentration and irritability. Keeping healthy, satisfying snacks within reach means you can fuel up without a long break.</p>

<h2>Top Picks from NigitTriple</h2>

<h3>Salysol Pipas Peladas (Spanish Kernels) — ₦900</h3>
<p>A premium Spanish snack in a convenient 60g tin. High in healthy fats and protein, they are filling, crunchy and surprisingly addictive. The resealable tin keeps them fresh at your desk for days.</p>

<h3>Ovaltine Sachets</h3>
<p>Keep a few sachets in your drawer for a mid-afternoon energy boost. The vitamins and minerals help combat the 3pm slump that hits even the most dedicated Port Harcourt professional.</p>

<h3>Cube Sugar for Your Tea Corner</h3>
<p>If your office has a tea point, a box of Golden Penny Cube Sugar is the professional's choice — no sticky spoons, consistent sweetness, and it looks good on the pantry counter.</p>

<h2>Order for Delivery to Your Office</h2>
<p>NigitTriple delivers to offices across Port Harcourt including GRA, Trans Amadi, Ada George, Woji, Rumuola and Eleme. Place a weekly snack order and never run out.</p>
      `.trim(),
      featuredImage: IMAGES.snacks,
      categoryId: lifestyle.id,
      tags: [
        "snacks",
        "office",
        "port harcourt",
        "work from home",
        "productivity",
      ],
      status: PostStatus.PUBLISHED,
      publishedAt: daysAgo(16),
    },

    // ── 7 ──────────────────────────────────────────────────────────────────────
    {
      title: "Halal Grocery Shopping in Port Harcourt: What You Need to Know",
      slug: "halal-grocery-shopping-port-harcourt",
      excerpt:
        "A guide to identifying and buying halal-certified groceries in Port Harcourt, with a look at what NigitTriple stocks.",
      content: `
<p>Port Harcourt has a significant Muslim population, and demand for halal-certified food products is growing. Navigating grocery stores to find halal options can be challenging — this guide helps.</p>

<h2>What Does Halal Certification Mean?</h2>
<p>Halal certification on food products means the item has been produced in accordance with Islamic dietary laws. This covers everything from the ingredients used to the equipment the product was made on and the slaughter method for any meat products.</p>

<h2>Common Halal Products at NigitTriple</h2>
<p>Many of our products carry halal certification. These include:</p>
<ul>
  <li><strong>Ovaltine Malted Food Drink</strong> — halal certified</li>
  <li><strong>Sunola Granulated White Sugar</strong> — halal certified</li>
  <li><strong>Golden Penny White Cube Sugar</strong> — halal certified</li>
  <li>Most plain grains, pulses and cooking oils</li>
</ul>

<h2>How to Identify Halal Products on Our Website</h2>
<p>On the NigitTriple product page, scroll to the product details section. Halal-certified products display a green "Halal" badge. You can also filter products by "Halal" in the dietary filters on our product listing page.</p>

<h2>Questions? Ask Us</h2>
<p>If you are unsure about a specific product's halal status, contact us via WhatsApp or email. Our team is always happy to verify certification details directly with the supplier.</p>
      `.trim(),
      featuredImage: IMAGES.market,
      categoryId: health.id,
      tags: ["halal", "port harcourt", "dietary", "muslim", "certified"],
      status: PostStatus.PUBLISHED,
      publishedAt: daysAgo(14),
    },

    // ── 8 ──────────────────────────────────────────────────────────────────────
    {
      title: "How We Deliver Groceries Across Rivers State",
      slug: "grocery-delivery-rivers-state-how-it-works",
      excerpt:
        "From your cart to your door — here is exactly how NigitTriple's delivery service works across Port Harcourt and Rivers State.",
      content: `
<p>One of the most common questions we receive at NigitTriple is: "Do you deliver to my area?" The short answer for most of Rivers State is yes. Here is a detailed breakdown of how our delivery service works.</p>

<h2>Coverage Areas</h2>
<p>We currently offer delivery to:</p>
<ul>
  <li><strong>Port Harcourt Metro</strong> — GRA, Trans Amadi, Rumuola, Ada George, Woji, Eleme, Diobu, Rumuigbo, Rumuokoro</li>
  <li><strong>Obio-Akpor</strong> — Rukpokwu, Choba, Ozuoba, Rumuola, Eneka</li>
  <li><strong>Other Rivers State LGAs</strong> — Bonny, Degema, Ahoada (extended delivery times apply)</li>
</ul>

<h2>Delivery Timelines</h2>
<p>Standard delivery within Port Harcourt Metro takes 1–2 business days. Same-day delivery is available for orders placed before 12 noon, subject to availability.</p>

<h2>Shipping Costs</h2>
<p>Delivery costs are calculated at checkout based on your location and order weight. Orders above a certain threshold qualify for free delivery — check the checkout page for the current free shipping threshold.</p>

<h2>Store Pickup Option</h2>
<p>Prefer to collect in person? Select "Store Pickup" at checkout. Our team will have your order ready and waiting, saving you delivery time and cost.</p>

<h2>Track Your Order</h2>
<p>Once your order ships, you will receive a tracking number by email and SMS. You can also track in real time through your account dashboard on our website.</p>
      `.trim(),
      featuredImage: IMAGES.delivery,
      categoryId: community.id,
      tags: [
        "delivery",
        "rivers state",
        "port harcourt",
        "shipping",
        "logistics",
      ],
      status: PostStatus.PUBLISHED,
      publishedAt: daysAgo(12),
    },

    // ── 9 ──────────────────────────────────────────────────────────────────────
    {
      title: "Nutritional Guide: What to Look For on Nigerian Food Labels",
      slug: "nutritional-guide-nigerian-food-labels",
      excerpt:
        "Nigerian food labels can be confusing. This guide explains what the numbers mean and how to use them to make healthier choices for your family.",
      content: `
<p>Most of us glance at food labels but few of us know how to read them properly. With grocery shopping increasingly moving online — including at NigitTriple — understanding label information is more important than ever.</p>

<h2>Serving Size</h2>
<p>All nutritional information is given per serving size. Always check how many servings are in the pack. Ovaltine, for example, lists 25g as one serving — but a 400g tin contains about 16 servings.</p>

<h2>Calories</h2>
<p>Calories (or kcal) measure the energy a food provides. The average Nigerian adult needs roughly 2,000–2,500 kcal per day. Ovaltine provides 388 kcal per 100g — a significant energy contribution from just one product.</p>

<h2>Macronutrients</h2>
<ul>
  <li><strong>Carbohydrates</strong> — the primary energy source. Sugar is a carbohydrate; check the "of which sugars" line for added sugars.</li>
  <li><strong>Protein</strong> — essential for muscle repair and growth. Nigerian diets often lack sufficient protein.</li>
  <li><strong>Fat</strong> — not all fat is bad. Look for products low in saturated fat and trans fat.</li>
</ul>

<h2>Micronutrients</h2>
<p>Iron, Vitamin D, Vitamin C and Calcium are frequently deficient in Nigerian diets. Products like Ovaltine are deliberately fortified with these nutrients — making them valuable beyond simple calories.</p>

<h2>Allergens</h2>
<p>Nigerian food law now requires common allergens to be declared on packaging. At NigitTriple, we display allergen information prominently on every product page to help families with dietary restrictions shop safely.</p>
      `.trim(),
      featuredImage: IMAGES.health,
      categoryId: health.id,
      tags: ["nutrition", "food labels", "health", "nigeria", "diet"],
      status: PostStatus.PUBLISHED,
      publishedAt: daysAgo(10),
    },

    // ── 10 ─────────────────────────────────────────────────────────────────────
    {
      title: "5 Easy Nigerian Recipes Using Granulated Sugar",
      slug: "easy-nigerian-recipes-granulated-sugar",
      excerpt:
        "From puff-puff to zobo drink — five classic Nigerian recipes that depend on granulated sugar, with tips on getting the sweetness right.",
      content: `
<p>Granulated white sugar is one of those ingredients that quietly anchors dozens of Nigerian recipes. Whether you are making a birthday cake in Rumuola or zobo drink for an Eid gathering in Borokiri, here are five recipes that showcase this humble staple.</p>

<h2>1. Puff-Puff</h2>
<p>Nigeria's favourite street snack. Mix 2 cups plain flour, 1 tablespoon granulated sugar, 1 teaspoon yeast, a pinch of salt and warm water into a smooth batter. Rest for 45 minutes, then deep-fry spoonfuls in vegetable oil. The sugar activates the yeast and adds just enough sweetness.</p>

<h2>2. Zobo (Hibiscus) Drink</h2>
<p>Boil dried zobo leaves with ginger, cloves and pineapple. Strain and sweeten with granulated sugar to taste — usually 3–4 tablespoons per litre. Chill before serving. The natural tartness of hibiscus needs proper sweetening, and Sunola granulated sugar dissolves cleanly.</p>

<h2>3. Chin-Chin</h2>
<p>Combine 2 cups flour, 3 tablespoons sugar, 1 egg, butter and a pinch of nutmeg. Knead, roll thin and cut into small strips. Fry until golden. The sugar content determines the crunch — more sugar means a harder, crunchier result.</p>

<h2>4. Kunu Zaki</h2>
<p>Fermented millet or sorghum drink sweetened with sugar and spiced with ginger. Granulated sugar blends more easily than cube sugar in this cold beverage.</p>

<h2>5. Nigerian Sponge Cake</h2>
<p>Cream 250g butter with 200g sugar until pale and fluffy. Add 4 eggs one at a time, fold in 250g self-raising flour, and bake at 180°C for 30–35 minutes. Golden Penny or Sunola sugar both work perfectly here.</p>

<p>All ingredients available at NigitTriple with delivery across Port Harcourt.</p>
      `.trim(),
      featuredImage: IMAGES.cooking,
      categoryId: lifestyle.id,
      tags: ["recipes", "sugar", "nigerian food", "cooking", "baking"],
      status: PostStatus.PUBLISHED,
      publishedAt: daysAgo(8),
    },

    // ── 11 ─────────────────────────────────────────────────────────────────────
    {
      title: "Why NigitTriple Chose Port Harcourt as Our Home",
      slug: "why-nigittriple-chose-port-harcourt",
      excerpt:
        "The story behind our decision to build a modern online grocery supermarket in the heart of Rivers State.",
      content: `
<p>Port Harcourt is Nigeria's oil capital, its garden city, and increasingly — its grocery innovation hub. When we founded NigitTriple, choosing Port Harcourt as our base was not a difficult decision.</p>

<h2>A City That Demands Quality</h2>
<p>Port Harcourt's professional class — engineers, bankers, doctors, civil servants and entrepreneurs — demands quality. They have travelled, they have seen how modern grocery retail works, and they expect the same at home. NigitTriple was built to meet that expectation.</p>

<h2>The Gap in the Market</h2>
<p>Before NigitTriple, Port Harcourt shoppers had limited options: neighbourhood markets with unpredictable stock, supermarkets with inconsistent inventory, or expensive trips to Lagos for specific imported products. We saw an opportunity to change that.</p>

<h2>Serving the Community</h2>
<p>From the traders in Mile 1 Market to the families in Woji estate, from oil workers in Trans Amadi to students at UNIPORT — NigitTriple serves all of Port Harcourt. We believe everyone deserves access to quality groceries at fair prices.</p>

<h2>What is Next</h2>
<p>We are expanding our product range, improving delivery times and building partnerships with local farmers and producers in Rivers State. The goal is a supermarket that serves Port Harcourt as well as any in Lagos or Abuja — but with the warm, community feel that makes this city special.</p>
      `.trim(),
      featuredImage: IMAGES.nigeria,
      categoryId: community.id,
      tags: [
        "nigittriple",
        "port harcourt",
        "story",
        "community",
        "rivers state",
      ],
      status: PostStatus.PUBLISHED,
      publishedAt: daysAgo(6),
    },

    // ── 12 ─────────────────────────────────────────────────────────────────────
    {
      title: "Grocery Shopping with Kids: Tips for Port Harcourt Parents",
      slug: "grocery-shopping-kids-tips-port-harcourt",
      excerpt:
        "Taking children grocery shopping can be stressful. These seven tips from Port Harcourt parents make it smoother — and even fun.",
      content: `
<p>If you have ever navigated a supermarket with a toddler demanding biscuits from every shelf, you know the struggle. Port Harcourt parents — often managing both careers and family — need practical strategies. Here is what works.</p>

<h2>1. Shop Online, Avoid the Trip</h2>
<p>The most effective tip is to use NigitTriple's online store. Browse and order during naptime, lunch break or after bedtime. Delivery brings everything to your door — no trolley negotiations required.</p>

<h2>2. Give Children a Job</h2>
<p>If you do shop in person, give children a role. Older children can push the trolley, find specific items from the list or count how many of something you need. Engaged children are less bored and less mischievous.</p>

<h2>3. Never Shop Hungry — Theirs or Yours</h2>
<p>Feed everyone before the shopping trip. Hungry children in a food environment is a recipe for tantrums and impulse purchases.</p>

<h2>4. Use a Printed or Written List</h2>
<p>Children respond well to a clear end goal. Show them the list and let them tick things off as you find them. This gamifies the experience and gives them a sense of progress.</p>

<h2>5. Set a Snack Rule in Advance</h2>
<p>Before entering the store, agree on whether they can have one treat — and which category it can come from. Ovaltine sachets or a small snack tin makes a fair, nutritious reward.</p>

<h2>6. Shop During Off-Peak Hours</h2>
<p>Port Harcourt supermarkets are quietest mid-morning on weekdays, before the lunch rush. Less crowd means less stimulation for children and more patience for everyone.</p>

<h2>7. Praise the Good Behaviour</h2>
<p>When children behave well in the store, say so specifically and warmly. Positive reinforcement builds the shopping habit over time.</p>
      `.trim(),
      featuredImage: IMAGES.family,
      categoryId: lifestyle.id,
      tags: ["parenting", "shopping tips", "port harcourt", "family", "kids"],
      status: PostStatus.PUBLISHED,
      publishedAt: daysAgo(4),
    },

    // ── 13 ─────────────────────────────────────────────────────────────────────
    {
      title: "The Complete Guide to Storing Groceries in Port Harcourt's Heat",
      slug: "storing-groceries-port-harcourt-heat",
      excerpt:
        "Hot, humid Port Harcourt weather is hard on groceries. Here is how to store different food categories to maximise shelf life.",
      content: `
<p>Port Harcourt's tropical climate — hot and humid year-round, with a long rainy season — creates unique challenges for food storage. Groceries that would last two weeks in London may only last five days here. Here is a category-by-category guide.</p>

<h2>Dry Goods and Staples</h2>
<p>Sugar, flour, salt, oats and similar dry goods must be stored in airtight containers away from moisture. Never leave them in the paper packaging they come in — the humidity in Port Harcourt will penetrate quickly. Invest in good quality plastic containers with tight-fitting lids.</p>

<h2>Beverages Like Ovaltine</h2>
<p>Ovaltine and similar malted drink powders should be resealed tightly after every use and stored away from the stove and any steam sources. Once opened, use within 60 days for best flavour and nutritional value.</p>

<h2>Cooking Oil</h2>
<p>Store cooking oils away from direct sunlight and heat. A pantry cupboard (not near the stove) is ideal. In Port Harcourt's heat, refined vegetable oils stay stable at room temperature for up to 12 months when properly sealed.</p>

<h2>Snack Foods</h2>
<p>Tin-packaged snacks like Salysol Pipas Peladas are well-suited to Port Harcourt's climate — the sealed tin keeps humidity out. Once opened, reseal with the original lid and consume within 3–5 days.</p>

<h2>Products That Need Refrigeration</h2>
<p>At NigitTriple, each product page clearly states whether refrigeration is required. If you lose power (common in many PH areas), move perishables to a cold bag with ice packs and consume quickly.</p>

<h2>NEPA and the Backup Plan</h2>
<p>Port Harcourt's power supply remains inconsistent in many areas. For households without 24-hour generator cover, focus your refrigerated purchases on items consumed within 24–48 hours, and lean on shelf-stable pantry staples as your backup.</p>
      `.trim(),
      featuredImage: IMAGES.grocery,
      categoryId: tips.id,
      tags: ["storage", "heat", "port harcourt", "food safety", "kitchen tips"],
      status: PostStatus.PUBLISHED,
      publishedAt: daysAgo(3),
    },

    // ── 14 ─────────────────────────────────────────────────────────────────────
    {
      title: "Building a Grocery Hamper for Special Occasions in Nigeria",
      slug: "grocery-hamper-special-occasions-nigeria",
      excerpt:
        "Hampers are a beloved Nigerian gift tradition. Here is how to build an impressive, thoughtful grocery hamper using products from NigitTriple.",
      content: `
<p>In Nigeria, giving a hamper is one of the most thoughtful gestures you can make. Whether it is Christmas, a new baby, a promotion, a wedding or Eid, a well-assembled grocery hamper says "I thought about you specifically." Here is how to build one that impresses.</p>

<h2>The Foundation: Staples Everyone Uses</h2>
<p>Every good hamper starts with staples. Granulated white sugar, premium cube sugar, a tin of Ovaltine and good cooking oil are universally appreciated. These are items every household uses, which means nothing goes to waste.</p>

<h2>The Speciality Layer: Something Different</h2>
<p>Add one or two items the recipient might not buy for themselves. Salysol Pipas Peladas from Spain, a premium Italian pasta or an imported juice adds an element of discovery and indulgence.</p>

<h2>The Sweet Touch</h2>
<p>Chocolate, biscuits or a premium malted drink round out the hamper. For Muslim recipients, ensure all sweets are halal-certified — NigitTriple labels this clearly on each product page.</p>

<h2>Presentation Matters</h2>
<p>Line a wicker basket or a sturdy box with tissue paper or raffia. Arrange taller items at the back and shorter items at the front. Wrap in cellophane and finish with a bow.</p>

<h2>Order Your Hamper Items from NigitTriple</h2>
<p>Browse our full catalogue, add your chosen products to cart and choose delivery or store pickup. We deliver across Port Harcourt and Rivers State. Contact us via WhatsApp to arrange hamper assembly assistance.</p>
      `.trim(),
      featuredImage: IMAGES.market,
      categoryId: lifestyle.id,
      tags: ["hamper", "gifts", "nigeria", "christmas", "occasions"],
      status: PostStatus.PUBLISHED,
      publishedAt: daysAgo(2),
    },

    // ── 15 ─────────────────────────────────────────────────────────────────────
    {
      title: "NigitTriple's Promotions of the Week: How It Works",
      slug: "nigittriple-promotions-of-the-week-explained",
      excerpt:
        "Our weekly promotions feature is one of our most popular tools for helping Port Harcourt shoppers save money. Here is everything you need to know.",
      content: `
<p>Every Monday morning, NigitTriple updates its "Promotions of the Week" section on the homepage. If you have not been taking advantage of this feature, you have been leaving money on the table. Here is everything you need to know.</p>

<h2>What Are the Promotions?</h2>
<p>Each week, we select a curated group of products and apply significant discounts — typically 10–30% off the regular price. These promotions are time-limited: they run from Monday to Sunday, then reset with a new set of products.</p>

<h2>How Are Products Selected?</h2>
<p>Our buying team looks at three things: seasonal relevance (zobo ingredients before Eid, for example), overstock that needs to move, and items our Port Harcourt customers have been searching for most. It is a mix of commercial reality and genuine service.</p>

<h2>How to Never Miss a Deal</h2>
<p>Subscribe to our newsletter using the form on this page. Every Sunday evening we send a preview of the following week's promotions to subscribers — before they go live on the homepage.</p>

<h2>Can I Combine Promotions with Discount Codes?</h2>
<p>In most cases, yes. Promotional pricing and discount codes can be stacked at checkout unless a specific promotion excludes additional discounts (which we always clearly state).</p>

<h2>This Week's Promotions</h2>
<p>Visit the NigitTriple homepage and scroll to the "Promotions of the Week" section to see what is on offer right now. New deals drop every Monday — so check in regularly and shop early before stock runs out.</p>
      `.trim(),
      featuredImage: IMAGES.supermarket,
      categoryId: tips.id,
      tags: ["promotions", "deals", "savings", "nigittriple", "weekly deals"],
      status: PostStatus.PUBLISHED,
      publishedAt: new Date(),
    },
  ];

  for (const post of posts) {
    await prisma.blogPost.create({ data: post });
    process.stdout.write(`  ✅ "${post.title}"\n`);
  }

  console.log(
    `\n🎉 Done! Created ${posts.length} blog posts across 5 categories.`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => await prisma.$disconnect());
