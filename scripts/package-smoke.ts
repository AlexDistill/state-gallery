import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
const exec = promisify(execFile);
const directory = await mkdtemp(join(tmpdir(), "sg-package-"));
try {
  const pack = await exec("npm", [
    "pack",
    "--json",
    "--pack-destination",
    directory,
  ]);
  const file = JSON.parse(pack.stdout)[0].filename;
  await writeFile(
    join(directory, "package.json"),
    JSON.stringify({ type: "module", private: true }),
  );
  await exec(
    "npm",
    [
      "install",
      "--ignore-scripts",
      join(directory, file),
      "@playwright/test@1.64.0",
    ],
    {
      cwd: directory,
    },
  );
  const help = await exec(
    process.execPath,
    [
      join(directory, "node_modules/@state-gallery/review/dist/cli/index.js"),
      "help",
    ],
    { cwd: directory },
  );
  if (!help.stdout.includes("export <journey>"))
    throw new Error("Packed CLI failed");
  const smoke = `import {captureJourney} from '@state-gallery/review/capture';import {chromium} from '@playwright/test';import {mkdtemp,readFile} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';const directory=await mkdtemp(join(tmpdir(),'consumer-capture-'));const browser=await chromium.launch();try{const page=await browser.newPage();const m=await captureJourney(page,{title:'External consumer',directory,steps:[{id:'first',title:'First',viewport:{width:390,height:844},show:async p=>{await p.setContent('<h1>External consumer capture</h1>')}}]});if(m.coverage!=='complete'||!(await readFile(join(directory,'first.png'))).length)throw new Error('Packed helper failed');console.log('Packed helper captured a real browser successfully');}finally{await browser.close()}`;
  await writeFile(join(directory, "smoke.mjs"), smoke);
  const helper = await exec(process.execPath, ["smoke.mjs"], {
    cwd: directory,
  });
  console.log(help.stdout.split("\n")[0]);
  console.log(helper.stdout.trim());
  console.log("Packed consumer smoke passed");
} finally {
  await rm(directory, { recursive: true, force: true });
}
