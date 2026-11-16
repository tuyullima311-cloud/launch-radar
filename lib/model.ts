// Launch Radar model: one sealed snapshot in, one ranked board of pre-token protocols out.
//
// The board ranks protocols that record no token yet by the value a token would carry if the
// protocol's record stayed as it is. The value is not a guess per name: it is priced off the
// snapshot's own market. Protocols whose token already trades give, category by category, the
// multiple of market cap to TVL the market actually pays; a pre-token protocol is priced at its
// category's multiple, adjusted for its seven-day TVL momentum, for how long it has run with no
// token, and for how many chains it runs on. No protocol name is special-cased anywhere: one
// function prices every row, and the dashboard shows the same arithmetic.
//
//   comps      live protocols (token trades, mcap and TVL both recorded): ratio = mcap / tvl,
//              each ratio winsorized at the market-wide 90th percentile, so one frothy token
//              (a $2.6B market cap on $7M of TVL) cannot price a whole category by itself
//   multiple   the category's median ratio, shrunk toward the global median by sample size:
//              used = (n x median + K x global) / (n + K), K = SHRINKAGE_K; the category's 25th
//              and 75th percentile ratios, shrunk the same way, give the row's value range
//   momentum   g = clamp(change_7d, -60, +150) per cent (unreported counts as 0)
//              mult = 1 + 0.55 x g / (|g| + 45)          (saturating: about 0.69x to 1.42x)
//   maturity   y = age in years (unknown age takes the board's median known age)
//              mult = 0.78 + 0.38 x (1 - exp(-y / 1.6))   (about 0.78x fresh to 1.16x seasoned)
//   breadth    mult = 1 + 0.025 x min(chains - 1, 6)      (1.00x single-chain to 1.15x)
//   implied    = max(1, round(tvl x multiple x momentum x maturity x breadth))
//   range      = the same product with the category's p25 and p75 multiples in place of the median
//
// Coverage: every watchlist slug is ranked, always. Below the floor the radar adds every other
// pre-token protocol that is an independent launch candidate: not a versioned deployment of
// another protocol, not an exchange's own product, and not a wrapped, staked or bridged claim on
// an asset that already trades (those are another protocol's product, not a launch of their own).

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, stated in the dashboard's Method view so a reader can re-run the sums. */
export interface ModelConstants {
  shrinkage_k: number;
  momentum_strength: number;
  momentum_scale: number;
  momentum_floor_pct: number;
  momentum_cap_pct: number;
  maturity_base: number;
  maturity_gain: number;
  maturity_tau_years: number;
  breadth_per_chain: number;
  breadth_max_extra: number;
}

export const MODEL: ModelConstants = {
  shrinkage_k: 8,
  momentum_strength: 0.55,
  momentum_scale: 45,
  momentum_floor_pct: -60,
  momentum_cap_pct: 150,
  maturity_base: 0.78,
  maturity_gain: 0.38,
  maturity_tau_years: 1.6,
  breadth_per_chain: 0.025,
  breadth_max_extra: 6,
};

/** The model's version label: the dashboard names it and the board's rows carry it. */
export const MODEL_VERSION = 'comps-2';

/** How many live-token protocols the dashboard's Live view carries, by market cap. */
export const LIVE_ROWS = 40;

/** One category's comparable set: the live protocols whose token prices the category. */
export interface CompStats {
  category: string;
  comps: number;
  median: number;
  p25: number;
  p75: number;
  /** The shrunk multiples the model actually prices with. */
  used: number;
  used_low: number;
  used_high: number;
}

/** The whole comparable market: the global set plus one entry per category that has comps. */
export interface CompMarket {
  global: CompStats;
  byCategory: Map<string, CompStats>;
  /** The 90th percentile of every comp ratio: the cap each ratio is winsorized at before use. */
  ratioCap: number;
}

/** How one protocol's implied value is built, factor by factor, for the detail view. */
export interface ValueBreakdown {
  multiple: number;
  multiple_low: number;
  multiple_high: number;
  comps: number;
  momentum_multiplier: number;
  maturity_multiplier: number;
  breadth_multiplier: number;
  age_days: number | null;
  implied_low_usd: number;
  implied_high_usd: number;
}

/** One row of board.json: the ranked board's row. Extra keys beyond the gate's five are the audit trail. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  model: ValueBreakdown & { version: string };
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the dashboard shows the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  symbol: string | null;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number;
  multiple: number | null;
}

/** The dashboard's data: the board, the comparable market, the live set and the model's own figures. */
export interface RadarData {
  schema: string;
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  model: ModelConstants & { imputed_age_days: number; ratio_cap: number };
  stats: {
    protocols: number;
    pre_token: number;
    live: number;
    board_rows: number;
    watchlist_rows: number;
    early_rows: number;
    comp_protocols: number;
    board_tvl_usd: number;
    board_implied_usd: number;
  };
  global_multiple: CompStats;
  multiples: CompStats[];
  rows: BoardRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;
const bySlugAsc = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** A whole day count from `listedAt` to `asOf`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether a protocol records no token at all: the radar's whole subject. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** DefiLlama's version-marker rule: a name ending in a release is a deployment of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Categories that are by construction a claim on another asset or an exchange's own book. Bridge
 *  joins the house's own list for the same reason the watchlist rule gives it: in this record the
 *  bridge category is transport for other ecosystems' assets (WBTC, USDT0 and their kin), not an
 *  independent protocol waiting on a launch of its own. */
const PRODUCT_CATEGORIES = new Set(['CEX', 'Bridge', 'Canonical Bridge', 'Restaked BTC', 'Stablecoin Wrapper']);

/** Whole words that mark a wrapped or staked product of an asset that already trades. */
const PRODUCT_WORD = /\b(wrapped|staked|staking)\b/i;

/** Exchanges whose name at the front of a protocol's name marks the exchange's own product. */
const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/**
 * Whether a pre-token protocol below the floor is an independent launch candidate: not a versioned
 * deployment, not an exchange product, not a wrapped or staked claim on a trading asset. The
 * watchlist never passes through here: the house's list is ranked as given.
 */
export function isLaunchCandidate(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (VERSIONED.test(p.name)) return false;
  if (p.category !== null && PRODUCT_CATEGORIES.has(p.category)) return false;
  if (PRODUCT_WORD.test(p.name)) return false;
  if (EXCHANGE_PREFIXES.some((e) => p.name.startsWith(e))) return false;
  return true;
}

// ---------------------------------------------------------------- the comparable market

/** The median of a non-empty list, on a sorted copy. */
function median(sorted: number[]): number {
  const m = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[m]! : (sorted[m - 1]! + sorted[m]!) / 2;
}

/** The q-quantile of a sorted list, by the nearest lower index (the house README's own reading). */
function quantile(sorted: number[], q: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
}

/** One category's raw ratios into shrunk pricing multiples. */
function shrink(category: string, ratios: number[], global: { median: number; p25: number; p75: number }, k: number): CompStats {
  const sorted = [...ratios].sort((a, b) => a - b);
  const n = sorted.length;
  const med = median(sorted);
  const lo = quantile(sorted, 0.25);
  const hi = quantile(sorted, 0.75);
  const blend = (v: number, g: number): number => (n * v + k * g) / (n + k);
  return {
    category,
    comps: n,
    median: round4(med),
    p25: round4(lo),
    p75: round4(hi),
    used: round4(blend(med, global.median)),
    used_low: round4(blend(lo, global.p25)),
    used_high: round4(blend(hi, global.p75)),
  };
}

/**
 * The comparable market the snapshot carries: every live protocol with a recorded market cap and
 * TVL gives one mcap/TVL ratio; grouped by category, with the global set as the fallback price.
 */
export function compMarket(snapshot: Snapshot, model: ModelConstants = MODEL): CompMarket {
  const raw: { category: string; ratio: number }[] = [];
  for (const p of snapshot.protocols) {
    if (isPreToken(p) || p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    raw.push({ category: p.category ?? '(none)', ratio: p.mcap_usd / p.tvl_usd });
  }
  // Winsorize before anything is priced: a ratio past the market-wide 90th percentile counts as
  // that percentile, so a single frothy token cannot price a whole category by itself.
  const sortedRaw = raw.map((r) => r.ratio).sort((a, b) => a - b);
  const ratioCap = quantile(sortedRaw, 0.9);
  const ratiosByCategory = new Map<string, number[]>();
  const all: number[] = [];
  for (const r of raw) {
    const ratio = Math.min(r.ratio, ratioCap);
    all.push(ratio);
    const list = ratiosByCategory.get(r.category);
    if (list === undefined) ratiosByCategory.set(r.category, [ratio]);
    else list.push(ratio);
  }
  const sortedAll = [...all].sort((a, b) => a - b);
  const globalRaw = { median: median(sortedAll), p25: quantile(sortedAll, 0.25), p75: quantile(sortedAll, 0.75) };
  const global: CompStats = {
    category: '(all categories)',
    comps: all.length,
    median: round4(globalRaw.median),
    p25: round4(globalRaw.p25),
    p75: round4(globalRaw.p75),
    used: round4(globalRaw.median),
    used_low: round4(globalRaw.p25),
    used_high: round4(globalRaw.p75),
  };
  const byCategory = new Map<string, CompStats>();
  for (const [category, ratios] of ratiosByCategory) {
    byCategory.set(category, shrink(category, ratios, globalRaw, model.shrinkage_k));
  }
  return { global, byCategory, ratioCap };
}

/** The multiples one protocol is priced with: its category's shrunk set, or the global set. */
function multiplesFor(p: SnapshotProtocol, market: CompMarket): CompStats {
  if (p.category !== null) {
    const stats = market.byCategory.get(p.category);
    if (stats !== undefined) return stats;
  }
  return market.global;
}

// ---------------------------------------------------------------- the value model

/** The model's working context: the comparable market and the age an unknown listing date counts as. */
export interface ModelContext {
  market: CompMarket;
  imputedAgeDays: number;
}

/** Build the context from the snapshot: the comps, and the median known age of the board's candidates. */
export function modelContext(snapshot: Snapshot, model: ModelConstants = MODEL): ModelContext {
  const ages: number[] = [];
  for (const p of snapshot.protocols) {
    if (!isPreToken(p)) continue;
    const age = ageDays(snapshot.as_of, p.listed_at);
    if (age !== null) ages.push(age);
  }
  ages.sort((a, b) => a - b);
  return { market: compMarket(snapshot, model), imputedAgeDays: ages.length > 0 ? median(ages) : 365 };
}

/** The momentum multiplier: seven-day TVL growth, clamped, then saturated so one hot week cannot rule. */
export function momentumMultiplier(change7d: number | null, model: ModelConstants = MODEL): number {
  const g = Math.min(model.momentum_cap_pct, Math.max(model.momentum_floor_pct, change7d ?? 0));
  return 1 + model.momentum_strength * (g / (Math.abs(g) + model.momentum_scale));
}

/** The maturity multiplier: a longer record with no token prices higher, on a saturating curve. */
export function maturityMultiplier(age: number | null, ctx: ModelContext, model: ModelConstants = MODEL): number {
  const years = (age ?? ctx.imputedAgeDays) / 365;
  return model.maturity_base + model.maturity_gain * (1 - Math.exp(-years / model.maturity_tau_years));
}

/** The breadth multiplier: each extra chain a protocol runs on adds reach, up to a cap. */
export function breadthMultiplier(chainCount: number, model: ModelConstants = MODEL): number {
  return 1 + model.breadth_per_chain * Math.min(Math.max(chainCount - 1, 0), model.breadth_max_extra);
}

/** One protocol's implied value and its range, with every factor the detail view shows. */
export function impliedValue(p: SnapshotProtocol, snapshot: Snapshot, ctx: ModelContext, model: ModelConstants = MODEL): { implied: number; breakdown: ValueBreakdown } {
  const stats = multiplesFor(p, ctx.market);
  const age = ageDays(snapshot.as_of, p.listed_at);
  const mom = momentumMultiplier(p.change_7d, model);
  const mat = maturityMultiplier(age, ctx, model);
  const brd = breadthMultiplier(p.chains.length, model);
  const factors = mom * mat * brd;
  const implied = Math.max(1, Math.round(p.tvl_usd * stats.used * factors));
  const low = Math.max(1, Math.round(p.tvl_usd * stats.used_low * factors));
  const high = Math.max(low, Math.round(p.tvl_usd * stats.used_high * factors));
  return {
    implied,
    breakdown: {
      multiple: stats.used,
      multiple_low: stats.used_low,
      multiple_high: stats.used_high,
      comps: stats.comps,
      momentum_multiplier: round4(mom),
      maturity_multiplier: round4(mat),
      breadth_multiplier: round4(brd),
      age_days: age,
      implied_low_usd: low,
      implied_high_usd: high,
    },
  };
}

// ---------------------------------------------------------------- farm plans

/** The fee class of a chain: what a transaction there roughly costs a farmer. */
type ChainClass = 'ethereum' | 'solana' | 'bitcoin' | 'lowfee';

function chainClass(chain: string): ChainClass {
  if (chain === 'Ethereum') return 'ethereum';
  if (chain === 'Solana' || chain === 'Eclipse' || chain === 'Fogo') return 'solana';
  if (chain === 'Bitcoin') return 'bitcoin';
  return 'lowfee';
}

/** Gas for a setup of two or three transactions on the protocol's first chain. */
function setupGas(chain: string): string {
  switch (chainClass(chain)) {
    case 'ethereum': return 'about $14 of ETH gas';
    case 'solana': return 'under $0.10 of SOL fees';
    case 'bitcoin': return 'about $5 of BTC fees';
    default: return 'about $1 of gas';
  }
}

/** Gas for one weekly qualifying transaction on the protocol's first chain. */
function weeklyGas(chain: string): string {
  switch (chainClass(chain)) {
    case 'ethereum': return 'about $6 of ETH gas';
    case 'solana': return 'under $0.05 of SOL fees';
    case 'bitcoin': return 'about $2 of BTC fees';
    default: return 'about $0.30 of gas';
  }
}

/** How much capital one farm position carries, from the protocol's own TVL: bigger books, bigger ticket. */
function capitalFor(tvl: number): number {
  if (tvl >= 1_000_000_000) return 500;
  if (tvl >= 250_000_000) return 250;
  if (tvl >= 50_000_000) return 150;
  if (tvl >= 10_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: a young protocol needs a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 60;
  if (age < 180) return 90;
  if (age < 365) return 60;
  if (age < 730) return 45;
  return 30;
}

/** The playbook a category farms by: the group's name is matched on the snapshot's own category. */
type Playbook = 'lending' | 'dex' | 'yield' | 'bridge' | 'trading' | 'staking' | 'rwa' | 'stable' | 'chain' | 'launchpad' | 'payments' | 'insurance' | 'privacy' | 'generic';

function playbookFor(category: string | null): Playbook {
  switch (category) {
    case 'Lending': case 'Uncollateralized Lending': case 'CDP': case 'CDP Manager':
    case 'Collateral Markets': case 'Collateral Management': return 'lending';
    case 'Dexs': return 'dex';
    case 'Yield': case 'Yield Aggregator': case 'Leveraged Farming': case 'Farm': case 'Basis Trading':
    case 'Risk Curators': case 'Onchain Capital Allocator': case 'Liquidity Manager': case 'Indexes': return 'yield';
    case 'Bridge': case 'Cross Chain Bridge': return 'bridge';
    case 'Derivatives': case 'Options': case 'Options Vault': case 'Interest Rate Derivatives':
    case 'Synthetics': case 'Prediction Market': return 'trading';
    case 'Liquid Staking': case 'Liquid Restaking': case 'Restaking': case 'Staking Pool': return 'staking';
    case 'RWA': return 'rwa';
    case 'Dual-Token Stablecoin': case 'Algo-Stables': case 'Stablecoin Issuer': case 'Reserve Currency': return 'stable';
    case 'Chain': return 'chain';
    case 'Launchpad': return 'launchpad';
    case 'Payments': case 'Crypto Card Issuer': return 'payments';
    case 'Insurance': return 'insurance';
    case 'Privacy': return 'privacy';
    default: return 'generic';
  }
}

/** The two middle steps of a plan: the core position, then the second qualifying action. */
function coreSteps(book: Playbook, p: SnapshotProtocol, chain: string, cap: number, gas: string, weekly: string): [string, string] {
  const name = p.name;
  const half = Math.max(10, Math.round(cap / 2));
  const fifth = Math.max(10, Math.round(cap / 5));
  switch (book) {
    case 'lending': return [
      `Supply $${cap} of USDC to ${name}'s largest lending market on ${chain} and leave the deposit open, so the wallet counts as a real supplier from the first week. Cost: $${cap} of capital plus ${gas}. Time: 15 minutes to set up.`,
      `Borrow about 30% of the supplied value in the same market and re-supply it once, then leave the loop open and watch the health factor weekly. Cost: ${gas} for the extra transactions, plus a small interest spread. Time: 10 minutes.`,
    ];
    case 'dex': return [
      `Add $${cap} of liquidity to ${name}'s deepest stablecoin or blue-chip pool on ${chain}, split evenly between the two assets, and keep the LP position open. Cost: $${cap} of capital plus ${gas}. Time: 15 minutes to set up.`,
      `Route two or three small swaps a week through ${name}'s own interface instead of an aggregator, so the volume is credited to your wallet. Cost: ${weekly} per swap day, plus pool fees of roughly 0.05-0.3% a trade. Time: 5 minutes a swap day.`,
    ];
    case 'yield': return [
      `Deposit $${cap} of USDC into ${name}'s flagship vault on ${chain} and keep the vault shares in the same wallet for the whole farming window. Cost: $${cap} of capital plus ${gas}. Time: 15 minutes to set up.`,
      `Switch on auto-compounding if the vault offers it; if not, claim and re-deposit the rewards once a week so the balance history shows continuous, growing usage. Cost: ${weekly} for the weekly transaction. Time: 10 minutes a week.`,
    ];
    case 'bridge': return [
      `Bridge $${cap} of USDC from Ethereum to ${chain} through ${name}, then make one real transaction with the bridged funds in an app on the destination chain. Cost: $${cap} of capital plus ${gas} and the bridge fee shown before you sign. Time: 20 minutes including the wait for finality.`,
      `Two weeks later, bridge about $${half} back the other way, so the wallet shows sustained two-way usage rather than a single pass. Cost: ${gas} plus the bridge fee on the return leg. Time: 20 minutes.`,
    ];
    case 'trading': return [
      `Deposit $${cap} of USDC as margin on ${name} and open one small position, no more than 1x the deposit, in its most liquid market; close it after a day. Cost: $${cap} of margin plus ${gas} and trading fees of roughly 0.02-0.06% a side. Time: 20 minutes to set up.`,
      `Trade modest volume on two days a week - open and close one position per session - instead of one large trade, so the activity spans many weekly snapshots. Cost: trading fees on about $${half} of volume a week. Time: 15 minutes a session.`,
    ];
    case 'staking': return [
      `Stake $${cap} worth of the chain's native asset through ${name} on ${chain} and keep the staking receipt in the same wallet. Cost: $${cap} of capital plus ${gas}. Time: 15 minutes to set up.`,
      `If ${name} supports it, delegate or restake the receipt once and then leave both positions untouched for the full hold window; unstaking early usually resets eligibility counters. Cost: ${gas} for the extra transaction. Time: 10 minutes.`,
    ];
    case 'rwa': return [
      `Mint or buy $${cap} of ${name}'s tokenized asset on ${chain} through its own app and hold it in the farming wallet. Cost: $${cap} of capital plus ${gas} and any mint fee the app shows up front. Time: 20 minutes, including any onboarding the app requires.`,
      `Add a second purchase of about $${fifth} two weeks later, so the holding history shows accumulation rather than a single touch. Cost: about $${fifth} plus ${gas}. Time: 10 minutes.`,
    ];
    case 'stable': return [
      `Deposit $${cap} of USDC into ${name} on ${chain} and mint or hold its stable asset for the full farming window. Cost: $${cap} of capital plus ${gas}. Time: 15 minutes to set up.`,
      `Use the stable asset once inside the protocol - supply it, pair it or spend it as the app intends - so the wallet shows product usage and not just a mint. Cost: ${gas} for one transaction. Time: 10 minutes.`,
    ];
    case 'chain': return [
      `Bridge $${cap} of USDC to the ${name} chain and make the wallet active there in the first week: one swap and one deposit in a native app. Cost: $${cap} of capital plus ${gas} and bridge fees. Time: 30 minutes to set up.`,
      `Keep a small working balance on the chain and transact once a week in its own apps, so the wallet reads as an early active user of the chain itself. Cost: ${weekly} a week. Time: 10 minutes a week.`,
    ];
    case 'launchpad': return [
      `Register the farming wallet for ${name}'s next launch or allocation round and complete every whitelist step the app lists. Cost: ${gas}, plus any refundable deposit the round requires. Time: 20 minutes.`,
      `If the round opens, take a small allocation of about $${cap} and hold the position past the first day instead of flipping it. Cost: $${cap} of capital if the allocation fills. Time: 10 minutes to enter.`,
    ];
    case 'payments': return [
      `Fund the wallet with $${cap} of USDC and route one real payment or card top-up of about $${half} through ${name}. Cost: $${cap} of capital plus ${gas} and the service's stated fee. Time: 15 minutes.`,
      `Repeat a smaller payment of about $${Math.max(10, Math.round(cap / 4))} two weeks later, so the wallet shows recurring use of the product rather than a single test. Cost: the payment amount plus the stated fee. Time: 10 minutes.`,
    ];
    case 'insurance': return [
      `Buy about $${cap} of cover from ${name} on ${chain} for an asset you actually hold, and keep the policy for its full term. Cost: the premium the app quotes, plus ${gas}. Time: 15 minutes.`,
      `Stake about $${half} into ${name}'s risk pool if it offers one; the risk side is the side of the product a launch most often counts. Cost: about $${half} of capital plus ${gas}. Time: 10 minutes.`,
    ];
    case 'privacy': return [
      `Deposit $${cap} of a supported asset into ${name}'s shielded pool on ${chain} and keep it shielded for the full hold window. Cost: $${cap} of capital plus ${gas}. Time: 15 minutes to set up.`,
      `After two weeks, make one shielded transfer to a second wallet you control, so the history shows the product used as it is meant to be used. Cost: ${gas} for the transfer. Time: 10 minutes.`,
    ];
    default: return [
      `Deposit $${cap} of USDC into ${name}'s flagship product on ${chain} and keep the position open for the full farming window. Cost: $${cap} of capital plus ${gas}. Time: 15 minutes to set up.`,
      p.chains.length > 1
        ? `Repeat the core action on ${p.chains[1]}, the protocol's second chain, with about $${half}, so the wallet shows multi-chain usage of the same protocol. Cost: about $${half} plus ${gas}. Time: 15 minutes.`
        : `Make one more deposit of about $${Math.max(10, Math.round(cap / 4))} two weeks later, so the balance history shows accumulation over time rather than one touch. Cost: about $${Math.max(10, Math.round(cap / 4))} plus ${gas}. Time: 10 minutes.`,
    ];
  }
}

/**
 * A protocol's farm plan: six steps, each an action with what it costs and how long it takes,
 * derived from the protocol's own record - its category's playbook, its first chain's fee class,
 * a capital ticket from its TVL and a hold window from its age. Never a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): string[] {
  const chain = p.chains.length > 0 ? p.chains[0]! : 'its main chain';
  const gas = setupGas(chain);
  const weekly = weeklyGas(chain);
  const cap = capitalFor(p.tvl_usd);
  const hold = holdDaysFor(age);
  const [core, second] = coreSteps(playbookFor(p.category), p, chain, cap, gas, weekly);
  return [
    `Set up a fresh wallet for ${p.name}, fund it on ${chain} with the position capital plus gas money, and keep its seed phrase offline; never farm from a wallet that holds unrelated assets. Cost: ${gas} for the first funding transfer. Time: 10 minutes.`,
    core,
    second,
    `Check in once a week: open ${p.name}'s app, confirm the position is still live and counted, and make one small qualifying action in any week that has none. Cost: ${weekly} in a week you act. Time: 10 minutes a week.`,
    `Hold the position for at least ${hold} days, and every two weeks check ${p.name}'s own points, rewards or governance page for a snapshot or eligibility post. Cost: the $${cap} stays in the position; checking is free. Time: ${hold} days of holding, 5 minutes a check.`,
    `When a launch or rewards claim is announced, use only the link on ${p.name}'s official page or verified social account and never pay a fee to claim. Write the wallet, dates and transactions in a farm log before you unwind. Cost: ${gas} to claim or exit. Time: 15 minutes.`,
  ];
}

// ---------------------------------------------------------------- the board

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const ctx = modelContext(snapshot, model);
  const watch = new Set(snapshot.watchlist);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug on it is ranked, exactly as the house drew it.
  for (const slug of snapshot.watchlist) {
    const p = snapshot.protocols.find((q) => q.slug === slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // Below the floor, the radar's own catch: every other independent launch candidate.
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isLaunchCandidate(p)) chosen.set(p.slug, p);
  }
  const scored = [...chosen.values()].map((p) => {
    const { implied, breakdown } = impliedValue(p, snapshot, ctx, model);
    return { p, implied, breakdown };
  });
  scored.sort((a, b) => b.implied - a.implied || b.p.tvl_usd - a.p.tvl_usd || bySlugAsc(a.p.slug, b.p.slug));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    watchlist: watch.has(s.p.slug),
    age_days: s.breakdown.age_days,
    implied_value_usd: s.implied,
    model: { ...s.breakdown, version: MODEL_VERSION },
    farm_steps: farmSteps(s.p, s.breakdown.age_days),
  }));
}

/** The live-token protocols, by market cap, for the dashboard's Live view: the market's own values. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.mcap_usd !== null && p.mcap_usd > 0)
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || bySlugAsc(a.slug, b.slug))
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      symbol: p.symbol,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd!,
      multiple: p.tvl_usd > 0 ? round4(p.mcap_usd! / p.tvl_usd) : null,
    }));
}

/** Everything the dashboard renders, from the snapshot: board, comps, live set, model and counts. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const ctx = modelContext(snapshot, model);
  const multiples = [...ctx.market.byCategory.values()].sort((a, b) => bySlugAsc(a.category, b.category));
  const watchlistRows = board.filter((r) => r.watchlist).length;
  const radar: RadarData = {
    schema: 'launch-radar/v1',
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    model: { ...model, imputed_age_days: ctx.imputedAgeDays, ratio_cap: round4(ctx.market.ratioCap) },
    stats: {
      protocols: snapshot.protocols.length,
      pre_token: snapshot.protocols.filter(isPreToken).length,
      live: snapshot.protocols.filter((p) => !isPreToken(p)).length,
      board_rows: board.length,
      watchlist_rows: watchlistRows,
      early_rows: board.length - watchlistRows,
      comp_protocols: ctx.market.global.comps,
      board_tvl_usd: board.reduce((n, r) => n + r.tvl_usd, 0),
      board_implied_usd: board.reduce((n, r) => n + r.implied_value_usd, 0),
    },
    global_multiple: ctx.market.global,
    multiples,
    rows: board,
    live: liveRows(snapshot),
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, values, farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set<string>();
  for (const r of board) {
    if (slugs.has(r.slug)) return `slug ${r.slug} appears twice`;
    slugs.add(r.slug);
    if (!snapshot.protocols.some((p) => p.slug === r.slug)) return `slug ${r.slug} is not in the snapshot`;
  }
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  if (board.length < 100 || board.length > 4000) return `the board holds ${board.length} rows, outside 100..4000`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  const byRank = [...board].sort((a, b) => a.rank - b.rank);
  for (let i = 1; i < byRank.length; i++) if (byRank[i]!.implied_value_usd > byRank[i - 1]!.implied_value_usd) return `rank ${i + 1} outranks rank ${i} on implied value`;
  if (board.length >= 2 && byRank[0]!.implied_value_usd === byRank[byRank.length - 1]!.implied_value_usd) {
    return 'every row shares one implied value: a board that ranks nothing by value is not a ranking';
  }
  for (const r of board) {
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 100_000_000_000_000) return `${r.slug} has implied value ${r.implied_value_usd}`;
    if (typeof r.name !== 'string' || r.name.length === 0) return `${r.slug} has no name`;
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} trimmed characters`;
    }
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
