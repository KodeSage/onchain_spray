/**
 * Pre-demo checklist, automated.
 *
 *   npx tsx scripts/preflight.ts
 *
 * Everything here is checked by reading real state, not by assuming. The
 * funding check in particular reads the master wallet's balance — the failure
 * mode it exists to catch is "we assumed it was funded" at 5:55pm.
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { createPublicClient, http, formatEther, parseEther, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { monadTestnet } from "../lib/chain";
import { ENDPOINTS, getEndpoint } from "../lib/rpc";
import { SPRAY_GAS_LIMIT } from "../lib/constants";

function loadEnv() {
  for (const file of [".env", ".env.local"]) {
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}

type Result = { ok: boolean | "warn"; label: string; detail: string };
const results: Result[] = [];

function pass(label: string, detail = "") {
  results.push({ ok: true, label, detail });
}
function fail(label: string, detail = "") {
  results.push({ ok: false, label, detail });
}
function warn(label: string, detail = "") {
  results.push({ ok: "warn", label, detail });
}

const BURNERS_EXPECTED = 130;
const TAPS_PER_BURNER = 200;

async function main() {
  loadEnv();

  /* ---- chain ----------------------------------------------------------- */
  const rpc = process.env.NEXT_PUBLIC_RPC_PRIMARY || ENDPOINTS[0].http;
  const client = createPublicClient({ chain: monadTestnet, transport: http(rpc, { timeout: 10_000 }) });

  try {
    const id = await client.getChainId();
    if (id === 10143) pass("chain reachable", `chainId ${id} via ${new URL(rpc).host}`);
    else fail("chain reachable", `expected 10143, got ${id}`);
  } catch (e) {
    fail("chain reachable", e instanceof Error ? e.message : "unreachable");
  }

  let gasPrice = 0n;
  try {
    gasPrice = await client.getGasPrice();
    pass("gas price", `${Number(gasPrice) / 1e9} gwei`);
  } catch {
    warn("gas price", "could not read");
  }

  /* ---- contract -------------------------------------------------------- */
  const contract = process.env.NEXT_PUBLIC_SPRAY_CONTRACT as Address | undefined;
  if (!contract) {
    fail("contract deployed", "NEXT_PUBLIC_SPRAY_CONTRACT not set — run npm run deploy");
  } else {
    try {
      const code = await client.getCode({ address: contract });
      if (code && code !== "0x") {
        pass("contract deployed", `${contract} (${(code.length - 2) / 2} bytes)`);
        console.log(`         explorer: ${monadTestnet.blockExplorers.default.url}/address/${contract}`);
      } else {
        fail("contract deployed", `no code at ${contract}`);
      }
    } catch (e) {
      fail("contract deployed", e instanceof Error ? e.message : "check failed");
    }
  }

  /* ---- funding wallet — read the balance, never assume ----------------- */
  const fundKey = process.env.FUNDING_PRIVATE_KEY;
  if (!fundKey) {
    fail("funding wallet", "FUNDING_PRIVATE_KEY not set — nobody can spray");
  } else {
    try {
      const master = privateKeyToAccount(fundKey as `0x${string}`);
      const balance = await client.getBalance({ address: master.address });
      const perTap = gasPrice > 0n ? gasPrice * SPRAY_GAS_LIMIT : 0n;
      const perBurner = perTap * BigInt(TAPS_PER_BURNER);
      const needed = perBurner * BigInt(BURNERS_EXPECTED);

      const detail =
        `${formatEther(balance)} MON at ${master.address}\n` +
        `         need ~${formatEther(needed)} MON for ${BURNERS_EXPECTED} burners ` +
        `x ${TAPS_PER_BURNER} taps (${formatEther(perTap)} MON/tap gas)`;

      if (needed > 0n && balance >= needed) pass("funding wallet", detail);
      else if (balance > 0n)
        fail(
          "funding wallet",
          `${detail}\n         SHORT BY ~${formatEther(needed - balance)} MON`
        );
      else fail("funding wallet", `EMPTY — ${master.address}`);
    } catch (e) {
      fail("funding wallet", e instanceof Error ? e.message : "check failed");
    }
  }

  /* ---- endpoint spread ------------------------------------------------- */
  const spread = new Map<string, number>();
  for (let i = 0; i < 500; i++) {
    const fake = `0x${i.toString(16).padStart(40, "0")}`;
    const e = getEndpoint(fake);
    spread.set(e.id, (spread.get(e.id) ?? 0) + 1);
  }
  const spreadText = [...spread.entries()]
    .map(([id, n]) => `${id} ${((n / 500) * 100).toFixed(0)}%`)
    .join(", ");
  if (process.env.NEXT_PUBLIC_RPC_PRIMARY) {
    pass("endpoint spread", `dedicated key in use — ${spreadText}`);
  } else if (spread.size >= 2) {
    warn("endpoint spread", `${spreadText} (public endpoints only — get a dedicated key)`);
  } else {
    fail("endpoint spread", `everyone on one endpoint: ${spreadText}`);
  }

  /* ---- env documented -------------------------------------------------- */
  if (existsSync(".env.example")) {
    const example = readFileSync(".env.example", "utf8");
    const documented = new Set(
      [...example.matchAll(/^([A-Z0-9_]+)=/gm)].map((m) => m[1])
    );
    const used = new Set<string>();
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name === ".next" || entry.name === ".git") continue;
        const full = `${dir}/${entry.name}`;
        if (entry.isDirectory()) walk(full);
        else if (/\.(ts|tsx|mjs)$/.test(entry.name)) {
          for (const m of readFileSync(full, "utf8").matchAll(/process\.env\.([A-Z0-9_]+)/g)) {
            used.add(m[1]);
          }
        }
      }
    };
    walk(".");
    const missing = [...used].filter(
      (v) => !documented.has(v) && !["NODE_ENV"].includes(v)
    );
    if (missing.length === 0) pass("env vars documented", `${documented.size} in .env.example`);
    else fail("env vars documented", `missing from .env.example: ${missing.join(", ")}`);
  } else {
    fail("env vars documented", ".env.example not found");
  }

  /* ---- secrets in git -------------------------------------------------- */
  try {
    const tracked = execSync("git ls-files", { encoding: "utf8" }).split("\n");
    const bad = tracked.filter((f) => /^\.env($|\.local|\.production)/.test(f));
    if (bad.length > 0) {
      fail("no secrets committed", `TRACKED: ${bad.join(", ")}`);
    } else {
      const hist = execSync(
        "git log --all --pretty=format:%H --name-only 2>/dev/null | sort -u || true",
        { encoding: "utf8", shell: "/bin/bash" }
      );
      const inHistory = hist
        .split("\n")
        .filter((f) => /^\.env($|\.local|\.production)/.test(f.trim()));
      if (inHistory.length > 0) fail("no secrets committed", `in history: ${inHistory.join(", ")}`);
      else pass("no secrets committed", ".env* absent from index and history");
    }
  } catch {
    warn("no secrets committed", "could not inspect git");
  }

  /* ---- QR target ------------------------------------------------------- */
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl) {
    warn("QR target", "NEXT_PUBLIC_APP_URL unset — QR falls back to window.origin");
  } else if (/localhost|127\.0\.0\.1/.test(appUrl)) {
    warn("QR target", `${appUrl} — nobody in the room can scan localhost`);
  } else {
    pass("QR target", `${appUrl}/spray/0`);
  }

  /* ---- demo fallback --------------------------------------------------- */
  if (existsSync("lib/stage-feed.ts")) {
    const src = readFileSync("lib/stage-feed.ts", "utf8");
    if (src.includes("startDemoFeed")) pass("demo fallback", "/stage/0?demo=1 available offline");
    else fail("demo fallback", "demo feed missing");
  }

  /* ---- report ---------------------------------------------------------- */
  console.log("\n" + "=".repeat(74));
  console.log("PREFLIGHT");
  console.log("=".repeat(74));
  for (const r of results) {
    const mark = r.ok === true ? " OK " : r.ok === "warn" ? "WARN" : "FAIL";
    console.log(`[${mark}] ${r.label}`);
    if (r.detail) console.log(`         ${r.detail}`);
  }

  const failures = results.filter((r) => r.ok === false).length;
  const warnings = results.filter((r) => r.ok === "warn").length;
  console.log("\n" + "-".repeat(74));
  console.log(
    failures === 0
      ? `ready${warnings > 0 ? ` (${warnings} warning${warnings === 1 ? "" : "s"})` : ""}`
      : `${failures} blocking issue${failures === 1 ? "" : "s"}`
  );
  console.log("");
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
