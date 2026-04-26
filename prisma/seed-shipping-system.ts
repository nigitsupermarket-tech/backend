import { PrismaClient, ShippingMethodType } from "@prisma/client";

const prisma = new PrismaClient();

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

// Zone configurations with shipping methods
const ZONES_CONFIG = [
  {
    name: "Lagos Metropolitan",
    description: "Lagos State - Fastest delivery",
    states: ["Lagos"],
    methods: [
      {
        name: "Express Delivery",
        type: "TABLE_RATE" as ShippingMethodType,
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
        type: "TABLE_RATE" as ShippingMethodType,
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
        type: "FLAT_RATE" as ShippingMethodType,
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
        type: "TABLE_RATE" as ShippingMethodType,
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
        type: "TABLE_RATE" as ShippingMethodType,
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
        type: "TABLE_RATE" as ShippingMethodType,
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
      {
        name: "Economy Delivery",
        type: "FLAT_RATE" as ShippingMethodType,
        flatRateCost: 2000,
        estimatedMinDays: 4,
        estimatedMaxDays: 6,
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
        type: "TABLE_RATE" as ShippingMethodType,
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
      {
        name: "Economy Delivery",
        type: "FLAT_RATE" as ShippingMethodType,
        flatRateCost: 2500,
        estimatedMinDays: 5,
        estimatedMaxDays: 7,
      },
    ],
  },
  {
    name: "South South Zone",
    description: "Niger Delta and coastal states",
    states: ["Rivers", "Delta", "Bayelsa", "Edo", "Cross River", "Akwa Ibom"],
    methods: [
      {
        name: "Standard Delivery",
        type: "TABLE_RATE" as ShippingMethodType,
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
      {
        name: "Economy Delivery",
        type: "FLAT_RATE" as ShippingMethodType,
        flatRateCost: 3000,
        estimatedMinDays: 5,
        estimatedMaxDays: 7,
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
        type: "TABLE_RATE" as ShippingMethodType,
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
        type: "TABLE_RATE" as ShippingMethodType,
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
        type: "TABLE_RATE" as ShippingMethodType,
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

// Store pickup locations
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

async function main() {
  console.log("🚀 Starting comprehensive shipping system seed...\n");

  // Clear existing data
  console.log("🗑️  Clearing existing shipping data...");
  await prisma.shippingWeightRate.deleteMany();
  await prisma.shippingMethod.deleteMany();
  await prisma.shippingZone.deleteMany();
  console.log("✅ Cleared existing data\n");

  let totalZones = 0;
  let totalMethods = 0;
  let totalRates = 0;

  // Create zones and methods
  for (const zoneConfig of ZONES_CONFIG) {
    console.log(`📍 Creating zone: ${zoneConfig.name}`);

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
          flatRateCost: methodConfig.flatRateCost || null,
          estimatedMinDays: methodConfig.estimatedMinDays,
          estimatedMaxDays: methodConfig.estimatedMaxDays,
          applicableToAll: true,
          isActive: true,
        },
      });

      totalMethods++;

      if (methodConfig.type === "TABLE_RATE" && methodConfig.weightRates) {
        for (const rate of methodConfig.weightRates) {
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

  // Create store pickup methods for Lagos and Abuja
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

  console.log("\n" + "=".repeat(80));
  console.log("🎉 SHIPPING SYSTEM SEED COMPLETED!");
  console.log("=".repeat(80));

  console.log(`\n📊 Summary:`);
  console.log(`  ✓ Zones Created: ${totalZones}`);
  console.log(`  ✓ Shipping Methods: ${totalMethods}`);
  console.log(`  ✓ Weight Rates: ${totalRates}`);
  console.log(`  ✓ All ${NIGERIAN_STATES.length} Nigerian states covered`);

  console.log(`\n💡 Method Types:`);
  console.log(`  • TABLE_RATE: Dynamic pricing based on weight`);
  console.log(`  • FLAT_RATE: Fixed cost regardless of weight`);
  console.log(`  • STORE_PICKUP: Free pickup at store locations`);

  console.log(`\n🏪 Store Pickup Locations:`);
  STORE_PICKUP_LOCATIONS.forEach((store) => {
    console.log(`  • ${store.name} - ${store.city}`);
  });

  console.log(`\n📦 Weight Brackets:`);
  console.log(`  • 0-5 kg: Light items`);
  console.log(`  • 5-10 kg: Medium items`);
  console.log(`  • 10-20 kg: Heavy items`);
  console.log(`  • 20-50 kg: Very heavy items`);
  console.log(`  • 50+ kg: Bulk items`);

  console.log("\n" + "=".repeat(80));
}

main()
  .catch((e) => {
    console.error("\n❌ Error seeding shipping system:");
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
