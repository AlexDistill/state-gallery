import assert from "node:assert/strict";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import {
  mkdtemp,
  writeFile,
  readFile,
  rm,
  mkdir,
  copyFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { createServer } from "node:http";
import { once } from "node:events";

const exec = promisify(execFile);
const root = await mkdtemp(join(tmpdir(), "sg package consumer "));
const fixture = createServer((_, res) => {
  res.setHeader("Content-Type", "text/html");
  res.end(
    "<html><title>Host app</title><h1>An unrelated host app</h1><button>Continue</button></html>",
  );
});
let service: ChildProcess | undefined;
let gitConsumer: string | undefined;
try {
  const pack = await exec("npm", [
    "pack",
    "--json",
    "--pack-destination",
    root,
  ]);
  const file = JSON.parse(pack.stdout)[0].filename;
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({ type: "module", private: true }),
  );
  await exec(
    "npm",
    [
      "install",
      "--ignore-scripts",
      join(root, file),
      "playwright@1.64.0",
      "typescript@5.9.2",
      "@types/node@22.18.0",
    ],
    { cwd: root },
  );
  const cli = join(
    root,
    "node_modules/@state-gallery/review/dist/cli/index.js",
  );
  const help = await exec(process.execPath, [cli, "help"], { cwd: root });
  assert.match(help.stdout, /export <journey>/);

  await writeFile(
    join(root, "consumer.ts"),
    `import {chromium} from 'playwright';
import {Client, type Manifest} from '@state-gallery/review';
import {captureJourney} from '@state-gallery/review/capture';
const client = new Client('http://localhost:4199');
const browser = await chromium.launch();
const page = await browser.newPage();
const manifest: Manifest = await captureJourney(page,{title:'Consumer',directory:'captures',steps:[{id:'first',title:'First',viewport:{width:390,height:844},show:async page=>{await page.setContent('<h1>Consumer</h1>')}}]});
const journey = await client.createJourney(manifest.title!);
await client.submitManifest(journey.id,'captures/manifest.json','one',{parentId:journey.currentId??undefined});
const authorized: boolean = (await client.getBuildBrief(journey.id)).authorized;
await browser.close();`,
  );
  await exec(
    process.execPath,
    [
      join(root, "node_modules/typescript/bin/tsc"),
      "--noEmit",
      "--module",
      "NodeNext",
      "--moduleResolution",
      "NodeNext",
      "--target",
      "ES2022",
      "consumer.ts",
    ],
    { cwd: root },
  );
  console.log(
    "Plain Playwright TypeScript consumer passed without @playwright/test",
  );

  await new Promise<void>((r) => fixture.listen(0, "127.0.0.1", r));
  const appPort = (fixture.address() as { port: number }).port;
  const portProbe = createServer();
  await new Promise<void>((r) => portProbe.listen(0, "127.0.0.1", r));
  const port = (portProbe.address() as { port: number }).port;
  await new Promise<void>((r) => portProbe.close(() => r()));
  const base = `http://127.0.0.1:${port}`;
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PORT: String(port),
    HOST: "127.0.0.1",
    STATE_GALLERY_ORIGIN: base,
    STATE_GALLERY_HOSTED: "false",
    STATE_GALLERY_DATA: join(root, "data"),
    STATE_GALLERY_OWNER_SECRET: "package-smoke-owner",
    STATE_GALLERY_URL: base,
    STATE_GALLERY_APP_URL: `http://127.0.0.1:${appPort}`,
  };
  delete env.STATE_GALLERY_TOKEN;
  service = spawn(process.execPath, [cli, "serve"], {
    cwd: root,
    env,
    stdio: "ignore",
  });
  let response: Response | undefined;
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      response = await fetch(base);
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
    if (service.exitCode !== null)
      throw new Error("Installed server exited before startup");
  }
  assert.equal(
    response?.status,
    200,
    "Installed server must serve its UI from a path containing spaces",
  );
  assert.match(await response!.text(), /State Gallery/);
  console.log("Installed server served the UI from a path containing spaces");

  await exec(process.execPath, [cli, "init"], { cwd: root, env });
  const starter = await readFile(
    join(root, "state-gallery.capture.mjs"),
    "utf8",
  );
  await assert.rejects(
    () => exec(process.execPath, [cli, "init"], { cwd: root, env }),
    (error: unknown) =>
      /already exists/.test((error as { stderr: string }).stderr),
  );
  assert.equal(
    await readFile(join(root, "state-gallery.capture.mjs"), "utf8"),
    starter,
  );
  const capture = await exec(process.execPath, ["state-gallery.capture.mjs"], {
    cwd: root,
    env,
  });
  assert.match(capture.stdout, /complete/);
  const created = await exec(
    process.execPath,
    [cli, "create", "External host app"],
    { cwd: root, env },
  );
  const journey = JSON.parse(created.stdout);
  await exec(
    process.execPath,
    [
      cli,
      "import",
      journey.id,
      "state-gallery-captures/manifest.json",
      "first-capture",
    ],
    { cwd: root, env },
  );
  const listed = await exec(process.execPath, [cli, "journeys"], {
    cwd: root,
    env,
  });
  assert.equal(JSON.parse(listed.stdout)[0].versions.length, 1);

  await writeFile(
    join(root, "client-smoke.mjs"),
    `import assert from 'node:assert/strict';import {Client} from '@state-gallery/review';
const client=Client.fromEnvironment();const journey=(await client.listJourneys())[0];
assert.equal(journey.versions[0].steps[0].kind,'capture');
await client.submitManifest(journey.id,'state-gallery-captures/manifest.json','second-capture',{parentId:journey.currentId});
assert.equal((await client.getJourney(journey.id)).versions.length,2);
assert.equal((await client.getBuildBrief(journey.id)).authorized,false);
console.log('Public client captured and submitted two immutable versions');`,
  );
  const client = await exec(process.execPath, ["client-smoke.mjs"], {
    cwd: root,
    env,
  });
  console.log(client.stdout.trim());
  console.log("CLI init/create/import and host-app capture passed");

  // Install a source-only Git checkout, matching npm's GitHub dependency path.
  const source = join(root, "source");
  const consumer = await mkdtemp(join(tmpdir(), "sg node consumer "));
  gitConsumer = consumer;
  await mkdir(source);
  const tracked = await exec("git", [
    "ls-files",
    "--cached",
    "--others",
    "--exclude-standard",
  ]);
  for (const name of tracked.stdout.trim().split("\n")) {
    const destination = join(source, name);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(resolve(name), destination);
  }
  await exec("git", ["init", "--quiet"], { cwd: source });
  await exec("git", ["add", "."], { cwd: source });
  await exec(
    "git",
    [
      "-c",
      "user.name=State Gallery Smoke",
      "-c",
      "user.email=smoke@example.invalid",
      "-c",
      "commit.gpgSign=false",
      "-c",
      "core.hooksPath=/dev/null",
      "commit",
      "--quiet",
      "-m",
      "Source fixture",
    ],
    { cwd: source },
  );
  await writeFile(
    join(consumer, "package.json"),
    JSON.stringify({ private: true, type: "module" }),
  );
  await exec(
    "npm",
    [
      "install",
      `git+${pathToFileURL(source).href}`,
      "typescript@5.9.2",
      "@types/node@22.18.0",
    ],
    {
      cwd: consumer,
    },
  );
  const cold = await exec(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      "import {Client} from '@state-gallery/review'; import {captureJourney} from '@state-gallery/review/capture'; import {createRequire} from 'node:module'; const require=createRequire(import.meta.url); if(typeof Client!=='function'||typeof captureJourney!=='function'||require('@state-gallery/review').Client!==Client) throw new Error('Missing ESM/CommonJS runtime'); console.log('Fresh Git dependency built and imported successfully in ESM and CommonJS');",
    ],
    { cwd: consumer },
  );
  console.log(cold.stdout.trim());
  await writeFile(
    join(consumer, "client.ts"),
    `import {Client} from '@state-gallery/review';const client=new Client('http://localhost:4199');const journey=await client.createJourney('Node app');const authorized:boolean=(await client.getBuildBrief(journey.id)).authorized;`,
  );
  await exec(
    process.execPath,
    [
      join(consumer, "node_modules/typescript/bin/tsc"),
      "--noEmit",
      "--module",
      "NodeNext",
      "--moduleResolution",
      "NodeNext",
      "--target",
      "ES2022",
      "client.ts",
    ],
    { cwd: consumer },
  );
  console.log("Standalone Node client typechecked without Playwright");
  console.log("Packed and Git consumer smoke passed");
} finally {
  if (service && service.exitCode === null && service.signalCode === null) {
    service.kill("SIGTERM");
    await once(service, "exit");
  }
  await new Promise<void>((r) => fixture.close(() => r()));
  await rm(root, { recursive: true, force: true });
  if (gitConsumer) await rm(gitConsumer, { recursive: true, force: true });
}
