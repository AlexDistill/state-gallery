import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import sharp from "sharp";
import { Store } from "../src/server/domain.js";
const dir = resolve(process.env.STATE_GALLERY_DATA ?? ".data");
mkdirSync(dir, { recursive: true });
const store = new Store(resolve(dir, "gallery.sqlite"));
if (store.list().length) {
  console.log("Demo already exists; leaving existing journeys intact.");
  store.close();
  process.exit(0);
}
const j = store.createJourney("A thoughtful first checkout");
const assets: Record<string, any> = {};
const titles = [
  "Find your next favorite",
  "A small, considered collection",
  "Ready for a new beginning",
];
for (let i = 0; i < 3; i++) {
  const svg = `<svg width="390" height="720" xmlns="http://www.w3.org/2000/svg"><rect width="390" height="720" fill="#fcfaf5"/><text x="30" y="48" font-family="sans-serif" font-size="18" fill="#2b3e2a">FIELDWORK</text><text x="320" y="48" font-family="sans-serif" font-size="14" fill="#697960">Bag (${i})</text><rect x="26" y="90" width="338" height="265" rx="8" fill="${["#d7dfcb", "#ead8c7", "#c8d7d3"][i]}"/><circle cx="195" cy="220" r="76" fill="${["#8a9d73", "#b58c69", "#71928b"][i]}"/><rect x="145" y="162" width="100" height="132" rx="15" fill="#f2eee2"/><path d="M165 166 Q165 120 195 120 Q225 120 225 166" stroke="#f2eee2" stroke-width="11" fill="none"/><text x="28" y="395" font-family="sans-serif" font-size="11" letter-spacing="2" fill="#7e886f">MADE FOR THE EVERYDAY</text><text x="28" y="433" font-family="sans-serif" font-size="23" fill="#2c3b27">${["Carry a little less.", "Good things, together.", "A moment to make it yours."][i]}</text><text x="28" y="470" font-family="sans-serif" font-size="13" fill="#78816e">Considered essentials. Room for what matters.</text><rect x="28" y="511" width="334" height="48" rx="4" fill="#355c40"/><text x="195" y="541" text-anchor="middle" font-family="sans-serif" font-size="14" fill="white">${["Explore the collection", "Add to your bag", "Continue to checkout"][i]}</text><line x1="28" y1="601" x2="362" y2="601" stroke="#d8ddcd"/><text x="28" y="638" font-family="sans-serif" font-size="12" fill="#79856e">Thoughtfully made. Meant to stay.</text></svg>`;
  const bytes = await sharp(Buffer.from(svg)).png().toBuffer();
  assets[`${i}.png`] = { bytes, mime: "image/png", width: 390, height: 720 };
}
const v = store.submit(
  j.id,
  {
    schemaVersion: 1,
    steps: titles.map((title, i) => ({
      id: ["discover", "collection", "checkout"][i],
      title,
      purpose: [
        "Introduce the collection and its point of view.",
        "Help someone choose an everyday essential.",
        "Give a clear next step, with confidence.",
      ][i],
      transition: [
        "Explore the collection",
        "Add a piece to the bag",
        "Continue to delivery details",
      ][i],
      kind: i === 2 ? "capture" : "mockup",
      viewport: { width: 390, height: 844 },
      image: `${i}.png`,
      provenance: "Synthetic Fieldwork demo. No client data.",
    })),
  },
  assets,
  "synthetic-demo-v1",
);
store.comment(
  j.id,
  v.id,
  "checkout",
  "Julio",
  "Could the delivery estimate sit closer to the checkout button?",
  { kind: "region", x: 0.06, y: 0.69, width: 0.87, height: 0.12 },
);
console.log(`Demo journey: ${j.id}`);
store.close();
