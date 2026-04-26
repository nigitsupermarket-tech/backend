import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL,
    },
  },
  log: ["error", "warn"],
});

const NIGERIAN_STATES = [
  "Abia",
  "Adamawa",
  "Akwa Ibom",
  "Anambra",
  "Bauchi",
  "Bayelsa",
  "Benue",
  "Borno",
  "Cross River",
  "Delta",
  "Ebonyi",
  "Edo",
  "Ekiti",
  "Enugu",
  "FCT - Abuja",
  "Gombe",
  "Imo",
  "Jigawa",
  "Kaduna",
  "Kano",
  "Katsina",
  "Kebbi",
  "Kogi",
  "Kwara",
  "Lagos",
  "Nasarawa",
  "Niger",
  "Ogun",
  "Ondo",
  "Osun",
  "Oyo",
  "Plateau",
  "Rivers",
  "Sokoto",
  "Taraba",
  "Yobe",
  "Zamfara",
];

async function seedOnly() {
  console.log("🌱 Seeding shipping system...\n");

  try {
    // Test connection first
    await prisma.$connect();
    console.log("✓ Connected to database\n");

    const ZONES_CONFIG = [
      {
        name: "Lagos Metropolitan",
        description: "Lagos State - Fastest delivery",
        states: ["Lagos"],
        methods: [
          {
            name: "Express Delivery",
            type: "TABLE_RATE" as const,
            estimatedMinDays: 1,
            estimatedMaxDays: 1,
            weightRates: [
              { minWeight: 0, maxWeight: 5, cost: 2500 },
              { minWeight: 5, maxWeight: 10, cost: 3500 },
              { minWeight: 10, maxWeight: 20, cost: 5000 },
              { minWeight: 20, maxWeight: 50, cost: 8000 },
              { minWeight: 50, maxWeight: null, cost: 12000 },
            ],
          },
          {
            name: "Standard Delivery",
            type: "TABLE_RATE" as const,
            estimatedMinDays: 2,
            estimatedMaxDays: 3,
            weightRates: [
              { minWeight: 0, maxWeight: 5, cost: 1500 },
              { minWeight: 5, maxWeight: 10, cost: 2000 },
              { minWeight: 10, maxWeight: 20, cost: 3000 },
              { minWeight: 20, maxWeight: 50, cost: 5000 },
              { minWeight: 50, maxWeight: null, cost: 8000 },
            ],
          },
          {
            name: "Economy Delivery",
            type: "FLAT_RATE" as const,
            flatRateCost: 1000,
            estimatedMinDays: 3,
            estimatedMaxDays: 5,
          },
        ],
      },
      {
        name: "FCT Abuja",
        description: "Federal Capital Territory",
        states: ["FCT - Abuja"],
        methods: [
          {
            name: "Express Delivery",
            type: "TABLE_RATE" as const,
            estimatedMinDays: 1,
            estimatedMaxDays: 2,
            weightRates: [
              { minWeight: 0, maxWeight: 5, cost: 3000 },
              { minWeight: 5, maxWeight: 10, cost: 4000 },
              { minWeight: 10, maxWeight: 20, cost: 6000 },
              { minWeight: 20, maxWeight: 50, cost: 9000 },
              { minWeight: 50, maxWeight: null, cost: 14000 },
            ],
          },
          {
            name: "Standard Delivery",
            type: "TABLE_RATE" as const,
            estimatedMinDays: 2,
            estimatedMaxDays: 3,
            weightRates: [
              { minWeight: 0, maxWeight: 5, cost: 2000 },
              { minWeight: 5, maxWeight: 10, cost: 2500 },
              { minWeight: 10, maxWeight: 20, cost: 3500 },
              { minWeight: 20, maxWeight: 50, cost: 6000 },
              { minWeight: 50, maxWeight: null, cost: 10000 },
            ],
          },
        ],
      },
      {
        name: "South West Zone",
        description: "South Western states",
        states: ["Ogun", "Oyo", "Osun", "Ondo", "Ekiti"],
        methods: [
          {
            name: "Standard Delivery",
            type: "TABLE_RATE" as const,
            estimatedMinDays: 2,
            estimatedMaxDays: 4,
            weightRates: [
              { minWeight: 0, maxWeight: 5, cost: 2500 },
              { minWeight: 5, maxWeight: 10, cost: 3500 },
              { minWeight: 10, maxWeight: 20, cost: 5000 },
              { minWeight: 20, maxWeight: 50, cost: 8000 },
              { minWeight: 50, maxWeight: null, cost: 12000 },
            ],
          },
        ],
      },
      {
        name: "South East Zone",
        description: "South Eastern states",
        states: ["Anambra", "Enugu", "Imo", "Abia", "Ebonyi"],
        methods: [
          {
            name: "Standard Delivery",
            type: "TABLE_RATE" as const,
            estimatedMinDays: 3,
            estimatedMaxDays: 5,
            weightRates: [
              { minWeight: 0, maxWeight: 5, cost: 3000 },
              { minWeight: 5, maxWeight: 10, cost: 4000 },
              { minWeight: 10, maxWeight: 20, cost: 6000 },
              { minWeight: 20, maxWeight: 50, cost: 9000 },
              { minWeight: 50, maxWeight: null, cost: 14000 },
            ],
          },
        ],
      },
      {
        name: "South South Zone",
        description: "Niger Delta and coastal states",
        states: [
          "Rivers",
          "Delta",
          "Bayelsa",
          "Edo",
          "Cross River",
          "Akwa Ibom",
        ],
        methods: [
          {
            name: "Standard Delivery",
            type: "TABLE_RATE" as const,
            estimatedMinDays: 3,
            estimatedMaxDays: 5,
            weightRates: [
              { minWeight: 0, maxWeight: 5, cost: 3500 },
              { minWeight: 5, maxWeight: 10, cost: 4500 },
              { minWeight: 10, maxWeight: 20, cost: 6500 },
              { minWeight: 20, maxWeight: 50, cost: 10000 },
              { minWeight: 50, maxWeight: null, cost: 15000 },
            ],
          },
        ],
      },
      {
        name: "North Central Zone",
        description: "Middle Belt states",
        states: ["Kwara", "Kogi", "Benue", "Plateau", "Nasarawa", "Niger"],
        methods: [
          {
            name: "Standard Delivery",
            type: "TABLE_RATE" as const,
            estimatedMinDays: 3,
            estimatedMaxDays: 5,
            weightRates: [
              { minWeight: 0, maxWeight: 5, cost: 3000 },
              { minWeight: 5, maxWeight: 10, cost: 4000 },
              { minWeight: 10, maxWeight: 20, cost: 6000 },
              { minWeight: 20, maxWeight: 50, cost: 9000 },
              { minWeight: 50, maxWeight: null, cost: 14000 },
            ],
          },
        ],
      },
      {
        name: "North West Zone",
        description: "Northwestern states",
        states: [
          "Kaduna",
          "Kano",
          "Katsina",
          "Kebbi",
          "Sokoto",
          "Zamfara",
          "Jigawa",
        ],
        methods: [
          {
            name: "Standard Delivery",
            type: "TABLE_RATE" as const,
            estimatedMinDays: 4,
            estimatedMaxDays: 6,
            weightRates: [
              { minWeight: 0, maxWeight: 5, cost: 4000 },
              { minWeight: 5, maxWeight: 10, cost: 5000 },
              { minWeight: 10, maxWeight: 20, cost: 7000 },
              { minWeight: 20, maxWeight: 50, cost: 11000 },
              { minWeight: 50, maxWeight: null, cost: 16000 },
            ],
          },
        ],
      },
      {
        name: "North East Zone",
        description: "Northeastern states",
        states: ["Bauchi", "Gombe", "Taraba", "Adamawa", "Borno", "Yobe"],
        methods: [
          {
            name: "Standard Delivery",
            type: "TABLE_RATE" as const,
            estimatedMinDays: 5,
            estimatedMaxDays: 7,
            weightRates: [
              { minWeight: 0, maxWeight: 5, cost: 4500 },
              { minWeight: 5, maxWeight: 10, cost: 5500 },
              { minWeight: 10, maxWeight: 20, cost: 7500 },
              { minWeight: 20, maxWeight: 50, cost: 12000 },
              { minWeight: 50, maxWeight: null, cost: 18000 },
            ],
          },
        ],
      },
    ];

    const STORE_PICKUP_LOCATIONS = [
      {
        name: "Lagos Mainland Store",
        address: "123 Ikeja Way, Ikeja",
        city: "Lagos",
        phone: "+234 XXX XXX XXXX",
        hours: "Mon-Sat: 9AM-6PM",
      },
      {
        name: "Abuja Central Store",
        address: "456 Garki Street, Garki",
        city: "Abuja",
        phone: "+234 XXX XXX XXXX",
        hours: "Mon-Sat: 9AM-6PM",
      },
    ];

    let totalZones = 0;
    let totalMethods = 0;
    let totalRates = 0;

    // Create zones and methods
    for (const zoneConfig of ZONES_CONFIG) {
      console.log(`📍 Creating zone: ${zoneConfig.name}`);

      // Check if zone already exists
      const existingZone = await prisma.shippingZone.findFirst({
        where: { name: zoneConfig.name },
      });

      if (existingZone) {
        console.log(`  ⚠️  Zone already exists, skipping...`);
        continue;
      }

      const zone = await prisma.shippingZone.create({
        data: {
          name: zoneConfig.name,
          description: zoneConfig.description,
          states: zoneConfig.states,
          isActive: true,
        },
      });

      totalZones++;

      for (const methodConfig of zoneConfig.methods) {
        const method = await prisma.shippingMethod.create({
          data: {
            zoneId: zone.id,
            name: methodConfig.name,
            type: methodConfig.type,
            flatRateCost: (methodConfig as any).flatRateCost || null,
            estimatedMinDays: methodConfig.estimatedMinDays,
            estimatedMaxDays: methodConfig.estimatedMaxDays,
            applicableToAll: true,
            isActive: true,
          },
        });

        totalMethods++;

        if (
          methodConfig.type === "TABLE_RATE" &&
          (methodConfig as any).weightRates
        ) {
          for (const rate of (methodConfig as any).weightRates) {
            await prisma.shippingWeightRate.create({
              data: {
                methodId: method.id,
                minWeight: rate.minWeight,
                maxWeight: rate.maxWeight,
                cost: rate.cost,
              },
            });
            totalRates++;
          }
        }

        console.log(`  ✓ Created method: ${methodConfig.name}`);
      }
    }

    // Create store pickup methods
    console.log("\n🏪 Creating store pickup options...");

    for (const store of STORE_PICKUP_LOCATIONS) {
      const zoneName =
        store.city === "Lagos" ? "Lagos Metropolitan" : "FCT Abuja";
      const zone = await prisma.shippingZone.findFirst({
        where: { name: zoneName },
      });

      if (zone) {
        await prisma.shippingMethod.create({
          data: {
            zoneId: zone.id,
            name: `Store Pickup - ${store.name}`,
            type: "STORE_PICKUP",
            flatRateCost: 0,
            storeAddress: store,
            estimatedMinDays: 0,
            estimatedMaxDays: 0,
            applicableToAll: true,
            isActive: true,
          },
        });
        totalMethods++;
        console.log(`  ✓ Created pickup location: ${store.name}`);
      }
    }

    console.log("\n" + "=".repeat(70));
    console.log("✅ SEEDING COMPLETED!");
    console.log("=".repeat(70));

    console.log(`\n📊 Summary:`);
    console.log(`  ✓ Zones Created: ${totalZones}`);
    console.log(`  ✓ Shipping Methods: ${totalMethods}`);
    console.log(`  ✓ Weight Rates: ${totalRates}`);
    console.log(`  ✓ All ${NIGERIAN_STATES.length} Nigerian states covered\n`);
  } catch (error: any) {
    console.error("\n❌ Seeding failed:");

    if (error.code === "P2010") {
      console.error("\n🔌 CONNECTION ERROR:");
      console.error("Your MongoDB Atlas cluster is unreachable.");
      console.error("\nTroubleshooting:");
      console.error("1. Check your internet connection");
      console.error("2. Whitelist your IP in MongoDB Atlas Network Access");
      console.error("3. Verify DATABASE_URL in .env file");
      console.error("4. Check if MongoDB Atlas cluster is paused\n");
    } else if (error.code === "P2002") {
      console.error(
        "\n⚠️  Data already exists. Run cleanup first or use MongoDB Compass to delete manually.",
      );
    } else {
      console.error(error);
    }

    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

seedOnly();
