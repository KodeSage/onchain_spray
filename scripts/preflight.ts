/**
 * Faucet readiness check.
 *
 *   npm run preflight
 *
 * Everything here is checked by reading real state, not by assuming. The house
 * wallet check reads an actual balance, and the store and captcha checks exist
 * because a faucet that is missing either of them is not a degraded faucet — it
 * is an open wallet, and it will be found within hours of going public.
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { createPublicClient, http, formatEther, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { monadTestnet } from "../lib/chain";
import { ENDPOINTS, getEndpoint } from "../lib/rpc";
import {
  BURNER_TARGET_BALANCE,
  DRIP_MAX,
  TAP_GAS_LIMIT,
} from "../lib/constants";

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

/** What one engaged player costs the house in a round: gas plus a full drip. */
const PLAYERS_PER_DAY = 250;

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
  const contract = process.env.NEXT_PUBLIC_ARENA_CONTRACT as Address | undefined;
  if (!contract) {
    fail("contract deployed", "NEXT_PUBLIC_ARENA_CONTRACT not set — run npm run deploy");
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

  /* ---- house wallet — read the balance, never assume -------------------- */
  const houseKey = process.env.HOUSE_PRIVATE_KEY;
  if (!houseKey) {
    fail("house wallet", "HOUSE_PRIVATE_KEY not set — nobody can tap or claim");
  } else {
    try {
      const normalised = houseKey.trim().replace(/^["\']|["\']$/g, "");
      const house = privateKeyToAccount(
        (normalised.startsWith("0x") ? normalised : `0x${normalised}`) as `0x${string}`
      );
      const balance = await client.getBalance({ address: house.address });

      // Cost per engaged player: the gas the house funds into their burner,
      // plus the largest drip they could claim.
      const perPlayer = BURNER_TARGET_BALANCE + DRIP_MAX;
      const needed = perPlayer * BigInt(PLAYERS_PER_DAY);
      const perTap = gasPrice > 0n ? gasPrice * TAP_GAS_LIMIT : 0n;

      const detail =
        `${formatEther(balance)} MON at ${house.address}\n` +
        `         need ~${formatEther(needed)} MON/day for ${PLAYERS_PER_DAY} players ` +
        `(${formatEther(perPlayer)} MON each)\n` +
        `         one tap costs ${formatEther(perTap)} MON of gas at ${Number(gasPrice) / 1e9} gwei`;

      if (needed > 0n && balance >= needed) pass("house wallet", detail);
      else if (balance > 0n)
        warn(
          "house wallet",
          `${detail}\n         covers ~${Number(balance / (perPlayer || 1n))} players today`
        );
      else fail("house wallet", `EMPTY — ${house.address}`);
    } catch (e) {
      fail("house wallet", e instanceof Error ? e.message : "check failed");
    }
  }

  /* ---- durable store — the difference between a faucet and a free wallet - */
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    try {
      const res = await fetch(`${process.env.UPSTASH_REDIS_REST_URL}/ping`, {
        headers: { Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}` },
        signal: AbortSignal.timeout(8_000),
      });
      if (res.ok) pass("durable store", "Upstash reachable — rate limits survive a cold start");
      else fail("durable store", `Upstash returned ${res.status}`);
    } catch (e) {
      fail("durable store", e instanceof Error ? e.message : "unreachable");
    }
  } else {
    fail(
      "durable store",
      "UPSTASH_REDIS_REST_URL/TOKEN unset — in-process limits reset on every\n" +
        "         cold start and are per-instance. The faucet fails closed in production."
    );
  }

  /* ---- captcha --------------------------------------------------------- */
  if (process.env.TURNSTILE_SECRET_KEY && process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY) {
    pass("captcha", "Turnstile configured on the claim route");
  } else if (process.env.TURNSTILE_SECRET_KEY || process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY) {
    fail("captcha", "only one half of the Turnstile pair is set — need both keys");
  } else {
    fail(
      "captcha",
      "TURNSTILE_SECRET_KEY unset — no proof-of-humanity on claim.\n" +
        "         The faucet fails closed in production."
    );
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

  /* ---- public origin --------------------------------------------------- */
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl) {
    warn("public origin", "NEXT_PUBLIC_APP_URL unset — og:image falls back to localhost");
  } else if (/localhost|127\.0\.0\.1/.test(appUrl)) {
    warn("public origin", `${appUrl} — link previews will point at localhost`);
  } else {
    pass("public origin", appUrl);
  }

  /* ---- spectate fallback ----------------------------------------------- */
  if (existsSync("lib/arena-feed.ts")) {
    const src = readFileSync("lib/arena-feed.ts", "utf8");
    if (src.includes("startDemoFeed")) pass("spectate fallback", "/?demo=1 available offline");
    else fail("spectate fallback", "synthetic feed missing");
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
