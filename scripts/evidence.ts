import { chromium } from "@playwright/test";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
const directory = resolve(".evidence");
await mkdir(directory, { recursive: true });
const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  await page.goto("http://localhost:4199");
  await page
    .getByLabel("Installation secret")
    .fill(process.env.STATE_GALLERY_PREVIEW_SECRET ?? "");
  await page.getByRole("button", { name: "Open studio" }).click();
  await page
    .getByRole("button", { name: /A thoughtful first checkout/ })
    .click();
  await page.screenshot({
    path: join(directory, "demo-overview-desktop.png"),
    fullPage: true,
    mask: [page.locator(".secret")],
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: join(directory, "demo-overview-mobile.png"),
    fullPage: true,
    mask: [page.locator(".secret")],
  });
  await page
    .getByRole("button", { name: "Open Ready for a new beginning" })
    .click();
  await page.screenshot({
    path: join(directory, "demo-detail-mobile.png"),
    fullPage: true,
    mask: [page.locator(".secret")],
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: join(directory, "demo-detail-desktop.png"),
    fullPage: true,
    mask: [page.locator(".secret")],
  });
} finally {
  await browser.close();
}
const files = (await readdir(directory))
  .filter((n) => n.endsWith(".png"))
  .sort();
await writeFile(
  join(directory, "index.html"),
  `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>State Gallery · Local review evidence</title><style>body{font:15px system-ui;background:#f6f7f2;color:#263723;margin:32px}h1{font-size:32px;font-weight:500}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:24px}article{background:white;padding:18px;border:1px solid #dce2d4;border-radius:8px}img{width:100%;height:360px;object-fit:contain;object-position:top}a{color:inherit}p{color:#6d7b64}</style><h1>State Gallery · First-release evidence</h1><p>Synthetic screens only. Local evidence, no product approval or public publication. Credentials are masked.</p><main>${files.map((f) => `<article><h2>${f.replace(/\.png$/, "").replaceAll("-", " ")}</h2><a href="${f}"><img src="${f}" alt="${f}"></a></article>`).join("")}</main></html>`,
);
console.log(join(directory, "index.html"));
