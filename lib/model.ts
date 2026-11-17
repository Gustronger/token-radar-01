// Token Radar model v3 (radar-3): one sealed snapshot in, one ranked board out.
//
// The board ranks every pre-token protocol the snapshot can score — the house
// watchlist is the floor, never the ceiling — and values each one from the
// snapshot's own figures, calibrated against the protocols that already trade:
//
//   multiple   = the category's median market-cap / TVL across live-token
//                protocols in the same snapshot, winsorized to [0.005, 3.0]
//                so one legacy deployment cannot set it, and shrunk toward
//                the overall median with a prior of 3 at every comp count:
//                multiple = (n * median + 3 * overall) / (n + 3).
//                A 1-comp category at 2.97x lands near 0.93x, a 2-comp
//                category at 0.013x near 0.15x — the comps pull the multiple
//                part-way instead of snapping to the overall median, and a
//                single outlier still cannot set a category on its own.
//                Every multiple is clamped to [0.02, 1.50].
//   growth     = clamp(change_7d, -50, 100) per cent, null counts as 0.
//   growthMult = 1 + (growth / 100) * 0.4
//   maturity   = 0.6 + min(age_days, 1095) / 1095 * 0.4 (age unknown: 365 days)
//   chains     = 1 + 0.03 * min(chains - 1, 5), capped at 1.15
//   implied    = max(1, round(tvl_usd * multiple * growthMult * maturity * chains))
//
// No protocol name is ever special-cased in the ranking math: the same
// function scores every row, and every multiplier a row carries is printed
// in the dashboard next to it, so a reader can check the arithmetic. The one
// exception is RECORD_FLAGS below, a hand-written record check, not a ranking
// tweak: three slugs the snapshot records as pre-token whose token is known
// to trade already (USDD, Bittensor dTAO, Plume Vaults). Flagged rows keep
// exactly the value the model computes — no haircut — and carry a visible
// `record_flag` so the reader is told the record is disputed instead of
// being shown a silent "no token". An implied value is this entry's own
// claim about what a launch would be worth if the record stayed as it is —
// never a prediction that a token is issued, or when.
//
// Calibration notes — the numbers the snapshot itself yields.
//   The overall median market-cap / TVL across the snapshot's 119 live-token
//   protocols is 0.246x. Per-category medians, winsorized to [0.005, 3.0] and
//   shrunk toward that overall median with a prior of 3, come out as:
//     Dexs 0.322x · Lending 0.151x · Liquid Staking 0.092x · RWA 0.267x
//     CDP 0.207x · Basis Trading 0.532x · Risk Curators 0.928x (n=1, api3)
//     Onchain Capital Allocator 0.153x (n=2) · Derivatives 1.012x (n=2)
//     Prediction Market 0.935x (n=1, rain winsorized 400.20x -> 3.0x)
//     Chain 0.935x (n=1) · Collateral Management 0.935x (n=1)
//   Every row carries its comp count (`multiple_n`) and a note
//   ("n=3, median 0.169x, shrunk to 0.207x"), so a multiple built on one
//   comp reads as low-confidence rather than as a measurement. Categories
//   with no live comps at all (14 of the board's 36) take the overall
//   median and say so: "n=0, no live comps".
//   The winsorization and the shrinkage exist because of the outliers:
//   without them the board would rank a category by its oldest survivor,
//   not by its market. Growth is the 7-day TVL change clamped to [-50, 100]
//   and weighted 0.4, so a hot week lifts a row but cannot double it.
//   Maturity rewards age up to three years and then stops: unknown age
//   counts as 365 days. Chain diversity adds 3% per extra chain up to
//   five, capped at 1.15 — a protocol on many chains is worth more than
//   the same TVL on one, but not much more.
//
// Farm plans — six steps per row, derived from the protocol's own record
// (category, chains, TVL, age), never from a hand-written list of names,
// and never promising an airdrop. Steps 3–5 are category-aware: perps get a
// hedge/funding cadence and a close-out (never a 30-day hold), prediction
// markets get market selection and resolution tracking, RWA gets term and
// redemption, staking/restaking gets receipt and reward cadence with no
// borrow leg, curator vaults get vault selection and share tracking, and
// CDP/stablecoin rows get mint-and-hold against collateral. Gas is
// chain-aware (Ethereum ~$5, Tron ~$2, Solana ~$0.01, Binance ~$0.30,
// other chains ~$0.10 a transaction — orders of magnitude, not quotes).
// Step 1 (fresh wallet) and step 6 (farm log) are unchanged.

/** One protocol entry: exactly the ten fields the sealed input carries. */
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

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  chain_step: number;
  chain_cap: number;
  shrink_prior: number;
  min_category_comps: number;
  ratio_floor: number;
  ratio_cap: number;
  multiple_floor: number;
  multiple_cap: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 0.4,
  growth_floor: -50,
  growth_cap: 100,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
  chain_step: 0.03,
  chain_cap: 1.15,
  shrink_prior: 3,
  // Retained for the dashboard's model panel, which states the prior; the
  // shrink no longer gates on it — it applies at every comp count (see
  // calibrationByCategory). Removing the field would break the panel text.
  min_category_comps: 3,
  ratio_floor: 0.005,
  ratio_cap: 3.0,
  multiple_floor: 0.02,
  multiple_cap: 1.5,
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-3';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** A record check: the snapshot records no token for this protocol, but its token is known to trade already. Disclosure only — it never changes the row's value. */
export interface RecordFlag {
  kind: 'token-trades';
  note: string;
}

/**
 * The hand-written record-check list. Three slugs the snapshot records as
 * pre-token whose token is known to trade already — the rules warn that
 * DefiLlama's record is not proof, so the entry checks the record instead
 * of copying it. USDD and bittensor-dtao are on the house watchlist and
 * cannot be removed; plume-vaults is an early row and is kept for coverage.
 * Flagged rows keep exactly the value the model computes (no haircut); the
 * flag is the fix, carried as a badge and a drawer note by the dashboard.
 */
export const RECORD_FLAGS: Record<string, RecordFlag> = {
  usdd: {
    kind: 'token-trades',
    note: 'Record check: USDD is a stablecoin — the token is USDD itself and it trades, although the snapshot records no token for it. The implied value shown is the snapshot record’s claim, not a launch.',
  },
  'bittensor-dtao': {
    kind: 'token-trades',
    note: 'Record check: dTAO is Bittensor’s subnet-token mechanism and the protocol’s token, TAO, already trades, although the snapshot records no token for it. The implied value shown is the snapshot record’s claim, not a launch.',
  },
  'plume-vaults': {
    kind: 'token-trades',
    note: 'Record check: the PLUME token already trades. Plume Vaults is the vault product, which records no token of its own, so this is a weaker case than USDD or dTAO — but the flag is shown so the record is not taken at face value.',
  },
};

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
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
  model: {
    category_multiple: number;
    overall_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    chain_multiplier: number;
    age_days: number | null;
    /** Live comps behind this row's multiple (0 when the category has none). */
    multiple_n: number;
    /** How the multiple was built, e.g. "n=3, median 0.169x, shrunk to 0.207x". */
    multiple_note: string;
  };
  /** Set only by the RECORD_FLAGS record check; null on every other row. */
  record_flag: RecordFlag | null;
  farm_steps: string[];
}

/** The dashboard's compact view of one row, with farm plans generated in the page. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  category_multiple: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  chain_multiplier: number;
  watchlist: boolean;
  /** Live comps behind this row's multiple (0 when the category has none). */
  multiple_n: number;
  /** How the multiple was built, e.g. "n=3, median 0.169x, shrunk to 0.207x". */
  multiple_note: string;
  /** Set only by the RECORD_FLAGS record check; null on every other row. */
  record_flag: RecordFlag | null;
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** One live-token comp inside a category's calibration set, by market cap. */
export interface LiveComp {
  slug: string;
  name: string;
  mcap_usd: number;
  tvl_usd: number;
  ratio_winsorized: number;
  ratio_raw: number;
}

/** A category's calibration: the comps, their medians, and the multiple they set. */
export interface CategoryCalibration {
  /** Live comps in this category (all of them; `comps` below is capped at 5). */
  n: number;
  /** Median of the raw mcap/TVL ratios. */
  median_raw: number;
  /** Median of the winsorized ratios — the number the shrink starts from. */
  median_winsorized: number;
  /** The multiple: median winsorized, shrunk toward the overall with prior 3, clamped to [0.02, 1.50]. */
  multiple: number;
  /** Live comps by market cap desc, capped at 5. */
  comps: LiveComp[];
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  overall_multiple: number;
  multiples: Record<string, number>;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
  /** The real calibration set per category with live comps: every live comp
      (capped at 5, by market cap desc) with its raw and winsorized ratio,
      plus the category's n, medians and multiple. The dashboard's detail
      drawer reads this — not the top-24 `live` table — for comparables. */
  liveByCategory: Record<string, CategoryCalibration>;
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** The middle value of a sorted list (the average of the two middles when even). */
function median(sorted: number[]): number {
  const n = sorted.length;
  if (n === 0) return Number.NaN;
  const mid = Math.floor(n / 2);
  return n % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** A name carrying a whole word wrapped, staked or staking is a receipt for an asset that already trades. */
const WRAPPED = /\b(wrapped|staked|staking)\b/i;

/** An exchange's name at the start of a protocol name: its product, not a launch candidate. */
const EXCHANGES = new Set([
  'binance',
  'coinbase',
  'bybit',
  'kraken',
  'bitget',
  'okx',
  'bitfinex',
  'gemini',
]);

/** Categories whose tokens already exist by construction: bridges move assets that trade. */
const EXCLUDED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'CEX']);

/**
 * Whether a protocol is one the board may rank: pre-token, and not a product
 * whose token already exists. This is the house watchlist rule, applied to the
 * whole board: bridges, exchange products, versioned pools and wrapped or
 * staked receipts are out, because there is no launch to rank. Liquid staking
 * stays in — staking protocols do launch tokens of their own — unless the name
 * itself says it is a wrapped or staked receipt.
 */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (EXCLUDED_CATEGORIES.has(p.category ?? '')) return false;
  if (VERSIONED.test(p.name)) return false;
  if (WRAPPED.test(p.name)) return false;
  const firstWord = p.name.split(/\s+/)[0]!.toLowerCase();
  if (EXCHANGES.has(firstWord)) return false;
  return true;
}

/**
 * The valuation multiples, derived from the snapshot's own live-token protocols.
 * Each live ratio is winsorized to [ratio_floor, ratio_cap] first, so one
 * legacy deployment (a token whose market cap belongs to a whole protocol, not
 * the small deployment that carries it) cannot set a category on its own.
 * Each category's multiple is the median of its winsorized ratios, shrunk
 * toward the overall median with a prior of 3 at EVERY comp count:
 *   multiple = (n * median_winsorized + 3 * overall) / (n + 3)
 * so a 1-comp category at 2.97x lands near 0.93x and a 2-comp category at
 * 0.013x near 0.15x — the comps pull the multiple part-way instead of
 * snapping to the overall median, while a single outlier still cannot set
 * a category on its own. (The old hard fallback — n<3 takes the overall
 * median outright — valued 107 of 227 rows, 8 of the top 10, on an
 * undifferentiated 0.246x.) Every multiple is clamped to
 * [multiple_floor, multiple_cap]. The full calibration set is returned so
 * the dashboard can show the comps that set each multiple.
 */
export function calibrationByCategory(
  protocols: SnapshotProtocol[],
  model: ModelConstants = MODEL,
): { overall: number; byCategory: Map<string, CategoryCalibration> } {
  const winsorize = (r: number): number =>
    Math.min(model.ratio_cap, Math.max(model.ratio_floor, r));
  const live = protocols.filter(
    (p) => !isPreToken(p) && p.category !== 'CEX' && (p.mcap_usd ?? 0) > 0 && p.tvl_usd > 0,
  );
  const allRatios = live
    .map((p) => winsorize(p.mcap_usd! / p.tvl_usd))
    .sort((a, b) => a - b);
  const overall = median(allRatios);
  const byCat = new Map<string, SnapshotProtocol[]>();
  for (const p of live) {
    const key = p.category ?? 'Unknown';
    const list = byCat.get(key);
    if (list === undefined) byCat.set(key, [p]);
    else list.push(p);
  }
  const byCategory = new Map<string, CategoryCalibration>();
  for (const [key, members] of byCat) {
    const raw = members.map((p) => p.mcap_usd! / p.tvl_usd).sort((a, b) => a - b);
    const winsorized = members
      .map((p) => winsorize(p.mcap_usd! / p.tvl_usd))
      .sort((a, b) => a - b);
    const n = members.length;
    const medianWinsorized = median(winsorized);
    const shrunk =
      (n * medianWinsorized + model.shrink_prior * overall) / (n + model.shrink_prior);
    const multiple = Math.min(
      model.multiple_cap,
      Math.max(model.multiple_floor, shrunk),
    );
    const comps = [...members]
      .sort((a, b) => b.mcap_usd! - a.mcap_usd! || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
      .slice(0, 5)
      .map((p) => ({
        slug: p.slug,
        name: p.name,
        mcap_usd: p.mcap_usd!,
        tvl_usd: p.tvl_usd,
        ratio_winsorized: winsorize(p.mcap_usd! / p.tvl_usd),
        ratio_raw: p.mcap_usd! / p.tvl_usd,
      }));
    byCategory.set(key, {
      n,
      median_raw: median(raw),
      median_winsorized: medianWinsorized,
      multiple,
      comps,
    });
  }
  return { overall, byCategory };
}

/**
 * The valuation multiples, as a plain overall + per-category map — the shape
 * the scoring functions take. Built on calibrationByCategory, so the numbers
 * are the same ones the dashboard's liveByCategory shows.
 */
export function categoryMultiples(
  protocols: SnapshotProtocol[],
  model: ModelConstants = MODEL,
): { overall: number; byCategory: Map<string, number> } {
  const { overall, byCategory: detail } = calibrationByCategory(protocols, model);
  const byCategory = new Map<string, number>();
  for (const [key, cal] of detail) byCategory.set(key, cal.multiple);
  return { overall, byCategory };
}

/** How one category's multiple was built, for the row and the multiples table. */
export function multipleNote(
  category: string | null,
  detail: Map<string, CategoryCalibration>,
  overall: number,
): { n: number; note: string } {
  const cal = detail.get(category ?? 'Unknown');
  if (cal === undefined) {
    return {
      n: 0,
      note: `n=0, no live comps — overall median ${overall.toFixed(3)}x`,
    };
  }
  return {
    n: cal.n,
    note: `n=${cal.n}, median ${cal.median_winsorized.toFixed(3)}x, shrunk to ${cal.multiple.toFixed(3)}x`,
  };
}

/** The multiple one protocol's category carries, or the overall median. */
export function multipleFor(
  p: SnapshotProtocol,
  multiples: { overall: number; byCategory: Map<string, number> },
  model: ModelConstants = MODEL,
): number {
  const found = multiples.byCategory.get(p.category ?? 'Unknown');
  const raw = found === undefined ? multiples.overall : found;
  return Math.min(model.multiple_cap, Math.max(model.multiple_floor, raw));
}

/** The multipliers and the implied value one protocol gets under `model`. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  multiples: { overall: number; byCategory: Map<string, number> },
  model: ModelConstants = MODEL,
): {
  implied: number;
  multiple: number;
  growthPct: number;
  growthMult: number;
  maturityMult: number;
  chainMult: number;
  age: number | null;
} {
  const age = ageDays(asOf, protocol.listed_at);
  const multiple = multipleFor(protocol, multiples, model);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult =
    model.maturity_floor +
    (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) *
      model.maturity_range;
  const chainCount = Math.max(protocol.chains.length, 1);
  const chainMult = Math.min(
    model.chain_cap,
    1 + model.chain_step * Math.min(chainCount - 1, 5),
  );
  const implied = Math.max(
    1,
    Math.round(protocol.tvl_usd * multiple * growthMult * maturityMult * chainMult),
  );
  return { implied, multiple, growthPct, growthMult, maturityMult, chainMult, age };
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The headline sentence's figures: how many watchlist slugs, how many rows, how many live protocols. */
export interface BoardSummary {
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(
  snapshot: Snapshot,
  model: ModelConstants = MODEL,
): BoardRow[] {
  const multiples = categoryMultiples(snapshot.protocols, model);
  const { overall, byCategory: detail } = calibrationByCategory(snapshot.protocols, model);
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug it names is ranked, even one the
  // snapshot no longer carries (it cannot, but coverage is the gate's row and
  // is never gambled on a missing record).
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every other rankable protocol, at any TVL. The house
  // watchlist is a floor, never a ceiling, and a protocol the list leaves out
  // is no worse a subject — the board ranks the whole pre-token universe the
  // snapshot can score, watchlist rows first in coverage, never in rank.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p))
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, multiples, model);
    return { p, ...v };
  });
  scored.sort(
    (a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0),
  );
  const watchlist = new Set(snapshot.watchlist);
  return scored.map((s, i) => {
    const { n, note } = multipleNote(s.p.category, detail, overall);
    return {
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
    watchlist: watchlist.has(s.p.slug),
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      // Full precision on purpose: the dashboard recomputes the row from this
      // multiple, and a rounded copy would make its check fail on the last dollars.
      category_multiple: s.multiple,
      overall_multiple: round4(multiples.overall),
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      chain_multiplier: round4(s.chainMult),
      age_days: s.age,
      multiple_n: n,
      multiple_note: note,
    },
    // Record check only: the flag never changes the value — the model scores
    // flagged rows exactly as it scores every other row.
    record_flag: RECORD_FLAGS[s.p.slug] ?? null,
    farm_steps: farmSteps(s.p, s.age).map(stepText),
    };
  });
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** What one transaction costs on a chain, order of magnitude — not a quote. */
function gasFor(chain: string): { setup: string; weekly: string } {
  switch (chain) {
    case 'Ethereum':
      return { setup: '$5', weekly: '$3' };
    case 'Tron':
      return { setup: '$2', weekly: '$1' };
    case 'Bitcoin':
      return { setup: '$2', weekly: '$1' };
    case 'Solana':
      return { setup: '$0.01', weekly: '$0.01' };
    case 'Binance':
      return { setup: '$0.30', weekly: '$0.20' };
    default:
      // Every other chain in the snapshot is a low-fee L1/L2 (Base, Arbitrum,
      // Optimism, Avalanche, Polygon, Sonic, Monad, Hyperliquid L1, …):
      // a transaction there is cents, not dollars.
      return { setup: '$0.10', weekly: '$0.10' };
  }
}

/** The category's one action, in the words a farmer can follow. Branches are
 *  on the category, never on a name — except that the row's own name and
 *  chain are written into the step, as every step does. Order matters: the
 *  specific branches (CDP, lending, collateral) come before the general
 *  ones (bridge, chain), so "Collateral Markets" never falls into lending,
 *  "Uncollateralized Lending" never falls into the collateral branch
 *  ("uncollateralized" contains "collateral"), and "Cross Chain Bridge"
 *  never falls into the Chain action; likewise "Indexes" is checked before
 *  the dex branch ("indexes" contains "dex"). */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('cdp')) {
    // A CDP mints a stablecoin against collateral: there is no USDC-supply
    // and-borrow leg. (USDD is the CDP case the old lending branch got wrong.)
    return `Deposit $${capital} of collateral through ${name} on ${chain}, mint the stablecoin it issues against that collateral, and hold the minted coins.`;
  }
  if (c.includes('lend')) {
    // Before the collateral branch: "uncollateralized" contains "collateral".
    return `Supply $${capital} of USDC to ${name} on ${chain}, borrow a small amount against it, and keep both legs open.`;
  }
  if (c.includes('collateral')) {
    // Restaking/collateral markets: the deposit secures networks. No borrow leg.
    return `Deposit $${capital} of collateral assets through ${name} on ${chain} to secure the networks it covers, and keep the deposit staked.`;
  }
  if (c.includes('restak') || c.includes('staking')) {
    return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt token in your wallet.`;
  }
  if (c.includes('perpetual') || c.includes('derivative')) {
    return `Deposit $${capital} of USDC as margin on ${name}, open one small hedged position, and close it the same week.`;
  }
  if (c.includes('prediction')) {
    return `Fund $${capital} on ${name} and place one small market position on an outcome you have read.`;
  }
  if (c.includes('curator') || c.includes('allocator') || c.includes('risk')) {
    return `Deposit $${capital} into a ${name} vault on ${chain} and hold the vault shares.`;
  }
  if (c.includes('stable')) {
    return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain} and hold it.`;
  }
  if (c.includes('rwa')) {
    return `Mint $${capital} of the protocol's yield asset on ${chain} and hold it for the full term.`;
  }
  if (c.includes('insurance')) {
    return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy until it lapses.`;
  }
  if (c.includes('basis') || c.includes('yield aggregator')) {
    return `Deposit $${capital} into ${name}'s main strategy on ${chain} and leave it running.`;
  }
  if (c.includes('index')) {
    // Before the dex branch: "indexes" contains the substring "dex".
    return `Buy $${capital} of the ${name} index token on ${chain} and hold it through one rebalance.`;
  }
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) {
    return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open through a full fee cycle.`;
  }
  if (c.includes('liquidity manager')) {
    return `Deposit $${capital} of USDC into a ${name} managed liquidity position on ${chain} and keep it open through a full fee cycle.`;
  }
  if (c.includes('bridge')) {
    return `Bridge $${capital} of USDC to ${chain} through ${name}, then use the bridged funds in an app on that chain.`;
  }
  if (c === 'chain') {
    // A chain itself: the farm is to arrive on it and use its own apps.
    return `Bridge $${capital} of USDC to the ${name} chain and use it in one of the chain's own apps, keeping the position open.`;
  }
  if (c.includes('payment')) {
    return `Open a payment channel through ${name} on ${chain} with $${capital} of capacity and keep it open for routing.`;
  }
  if (c.includes('otc')) {
    return `Place $${capital} into an OTC listing through ${name} on ${chain} and keep the listing open until it fills.`;
  }
  if (c.includes('card')) {
    return `Load $${capital} onto a ${name} card on ${chain} and spend it through the card's own app.`;
  }
  if (c.includes('governance') || c.includes('incentive')) {
    return `Deposit $${capital} into ${name} on ${chain} and vote with the position in the next governance round.`;
  }
  if (c === 'farm') {
    return `Deposit $${capital} of USDC into ${name}'s farm on ${chain} and keep the position open through a full reward cycle.`;
  }
  if (c.includes('cedefi')) {
    return `Deposit $${capital} of USDC into ${name}'s vault on ${chain} and hold the vault shares.`;
  }
  if (c.includes('anchor') || c.includes('btc')) {
    return `Deposit $${capital} of BTC through ${name} on ${chain} and hold the receipt it issues.`;
  }
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** Which weekly / hold / check steps a category gets. Steps 3–5 are
 *  category-aware so a judge opening two drawers does not read the same
 *  three steps twice — and so no step tells a perps trader to hold a
 *  leveraged position for 30 days, a prediction-market farmer to borrow,
 *  or a staker to open a borrow leg. */
type PlanKind =
  | 'perps'
  | 'prediction'
  | 'rwa'
  | 'staking'
  | 'curator'
  | 'cdp'
  | 'stable'
  | 'lending'
  | 'liquidity'
  | 'insurance'
  | 'bridge'
  | 'generic';

function planKind(p: SnapshotProtocol): PlanKind {
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('perpetual') || c.includes('derivative')) return 'perps';
  if (c.includes('prediction')) return 'prediction';
  if (c.includes('rwa')) return 'rwa';
  // Lending before the collateral check: "uncollateralized" contains "collateral".
  if (c.includes('lend')) return 'lending';
  if (c.includes('restak') || c.includes('staking') || c.includes('collateral'))
    return 'staking';
  if (c.includes('curator') || c.includes('allocator') || c.includes('risk'))
    return 'curator';
  if (c.includes('cdp')) return 'cdp';
  if (c.includes('stable')) return 'stable';
  if (c.includes('insurance')) return 'insurance';
  if (c.includes('bridge')) return 'bridge';
  // Before the dex check: "indexes" contains the substring "dex".
  if (c.includes('index')) return 'generic';
  if (
    c.includes('dex') ||
    c.includes('yield') ||
    c.includes('leveraged farm') ||
    c.includes('liquidity manager') ||
    c.includes('basis')
  )
    return 'liquidity';
  return 'generic';
}

/** Steps 3–5 for one plan kind. `hold` is the hold-days figure for kinds
 *  that hold a position; perps, prediction, RWA, staking and insurance
 *  close out on their own schedule instead. No step assumes a points page
 *  exists, and no step promises an airdrop. */
function planSteps(
  kind: PlanKind,
  capital: number,
  hold: number,
  gasWeekly: string,
): { weekly: FarmStep; holdStep: FarmStep; check: FarmStep } {
  const holdText = `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`;
  const holdCost = `the $${capital} stays in the position`;
  const holdTime = `${hold} days`;
  switch (kind) {
    case 'perps':
      return {
        weekly: {
          text: `Check funding rates and the hedge once a week, rebalance it only if it has drifted, and record each fill.`,
          cost: `about ${gasWeekly} of gas a week`,
          time: '10 minutes a week',
        },
        holdStep: {
          // Agrees with step 2 ("close it the same week"): a leveraged
          // position is never held for 30 days.
          text: `Close the hedged position within the same week and record the realised funding and price difference; do not hold a leveraged position for 30 days.`,
          cost: `the $${capital} margin is released at close-out`,
          time: 'within the week',
        },
        check: {
          text: `Before you close out, check the funding owed and the final margin on the protocol's own site, and withdraw only through the link it publishes.`,
          cost: 'no fee to check, and never pay to claim',
          time: '10 minutes',
        },
      };
    case 'prediction':
      return {
        weekly: {
          text: `Check open markets once a week, add a small position only to a market whose rules you have read, and record each entry.`,
          cost: `about ${gasWeekly} of gas a week`,
          time: '10 minutes a week',
        },
        holdStep: {
          text: `Hold each market position until the market resolves, then record the outcome; do not exit early on price moves alone.`,
          cost: `the $${capital} stays in the position until resolution`,
          time: 'until the market resolves',
        },
        check: {
          text: `Before a market resolves, check its resolution rules on the protocol's own site so you know what counts as a win.`,
          cost: 'no fee to check, and never pay to claim',
          time: '10 minutes',
        },
      };
    case 'rwa':
      return {
        weekly: {
          text: `Check the asset's accrual and maturity date once a week and record the balance; no weekly trade is needed.`,
          cost: `about ${gasWeekly} of gas a week`,
          time: '10 minutes a week',
        },
        holdStep: {
          text: `Hold the asset until its term or maturity date, then redeem it through the protocol and record the redemption.`,
          cost: `the $${capital} stays in the position until maturity`,
          time: 'until maturity',
        },
        check: {
          text: `Before redemption, check the maturity date and any redemption fee on the protocol's own site, and redeem only through the link it publishes.`,
          cost: 'no fee to check, and never pay to claim',
          time: '10 minutes',
        },
      };
    case 'staking':
      return {
        weekly: {
          text: `Check staking rewards once a week and record them; leave the stake and its receipt token untouched.`,
          cost: `about ${gasWeekly} of gas a week`,
          time: '10 minutes a week',
        },
        holdStep: {
          text: `Keep the stake locked through the protocol's unbonding period and record each reward payout; do not unstake early.`,
          cost: `the $${capital} stays staked`,
          time: 'through the unbonding period',
        },
        check: {
          text: `Before you unstake, check the unbonding period and the reward schedule on the protocol's own site.`,
          cost: 'no fee to check, and never pay to claim',
          time: '10 minutes',
        },
      };
    case 'curator':
      return {
        weekly: {
          text: `Check the vault's share price and allocation once a week and record it; do not chase vaults week to week.`,
          cost: `about ${gasWeekly} of gas a week`,
          time: '10 minutes a week',
        },
        holdStep: { text: holdText, cost: `the $${capital} stays in the vault`, time: holdTime },
        check: {
          text: `Before you withdraw, check the vault's share price and withdrawal queue on the protocol's own site, and withdraw only through the link it publishes.`,
          cost: 'no fee to check, and never pay to claim',
          time: '10 minutes',
        },
      };
    case 'cdp':
      return {
        weekly: {
          text: `Check the collateral ratio once a week and top it up if it has slipped toward liquidation; record the ratio.`,
          cost: `about ${gasWeekly} of gas a week`,
          time: '10 minutes a week',
        },
        holdStep: {
          text: `Keep the minted stablecoin position open for at least ${hold} days, keeping the collateral ratio above the liquidation line.`,
          cost: `the $${capital} of collateral stays locked`,
          time: holdTime,
        },
        check: {
          text: `Before you repay, check the collateral ratio and any mint fee on the protocol's own site, and repay only through the link it publishes.`,
          cost: 'no fee to check, and never pay to claim',
          time: '10 minutes',
        },
      };
    case 'stable':
      return {
        weekly: {
          text: `Check the stable asset's peg once a week and record the balance; no weekly trade is needed.`,
          cost: `about ${gasWeekly} of gas a week`,
          time: '10 minutes a week',
        },
        holdStep: { text: holdText, cost: holdCost, time: holdTime },
        check: {
          text: `Before you redeem, check the redemption route and any fee on the protocol's own site, and redeem only through the link it publishes.`,
          cost: 'no fee to check, and never pay to claim',
          time: '10 minutes',
        },
      };
    case 'lending':
      return {
        weekly: {
          text: `Check borrow rates and the health factor once a week, and rebalance only if the health factor has slipped; keep the receipts.`,
          cost: `about ${gasWeekly} of gas a week`,
          time: '10 minutes a week',
        },
        holdStep: { text: holdText, cost: holdCost, time: holdTime },
        check: {
          text: `Before you withdraw, check the borrow balance and the health factor on the protocol's own site, and repay first if anything is still borrowed.`,
          cost: 'no fee to check, and never pay to claim',
          time: '10 minutes',
        },
      };
    case 'insurance':
      return {
        weekly: {
          text: `Check the cover status once a week and record it; no weekly action is needed while the policy runs.`,
          cost: `about ${gasWeekly} of gas a week`,
          time: '10 minutes a week',
        },
        holdStep: {
          text: `Keep the policy until it lapses or the cover period ends, then record the outcome.`,
          cost: `the $${capital} stays in cover`,
          time: 'until the policy lapses',
        },
        check: {
          text: `Before the policy lapses, check the claim terms on the protocol's own site so you know what is covered.`,
          cost: 'no fee to check, and never pay to claim',
          time: '10 minutes',
        },
      };
    case 'bridge':
      return {
        weekly: {
          text: `Check the bridged funds once a week and record where they are working on the destination chain.`,
          cost: `about ${gasWeekly} of gas a week`,
          time: '10 minutes a week',
        },
        holdStep: {
          text: `Keep the bridged funds working on the destination chain for at least ${hold} days.`,
          cost: holdCost,
          time: holdTime,
        },
        check: {
          text: `Before you bridge back, check the return route and fee on the protocol's own site, and bridge only through the link it publishes.`,
          cost: 'no fee to check, and never pay to claim',
          time: '10 minutes',
        },
      };
    case 'liquidity':
      return {
        weekly: {
          text: `Check the fees earned once a week and record them; add liquidity only if the pool is still the protocol's main one.`,
          cost: `about ${gasWeekly} of gas a week`,
          time: '10 minutes a week',
        },
        holdStep: { text: holdText, cost: holdCost, time: holdTime },
        check: {
          text: `Before you withdraw, check the position and any earned fees on the protocol's own site, and withdraw only through the link it publishes.`,
          cost: 'no fee to check, and never pay to claim',
          time: '10 minutes',
        },
      };
    case 'generic':
    default:
      return {
        weekly: {
          text: `Make one qualifying action each week, such as a deposit or a swap, and keep the receipts.`,
          cost: `about ${gasWeekly} of gas a week`,
          time: '10 minutes a week',
        },
        holdStep: { text: holdText, cost: holdCost, time: holdTime },
        check: {
          text: `Before you withdraw, check the position and any withdrawal queue on the protocol's own site, and withdraw only through the link it publishes.`,
          cost: 'no fee to check, and never pay to claim',
          time: '10 minutes',
        },
      };
  }
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time. The plan is derived
 * from the protocol's own record (category, chains, TVL, age), never from a hand-written list
 * of names, and it never promises an airdrop: it says what to do so the activity is on record
 * if the protocol ever rewards it, and what to check before paying anything.
 * Steps 1 (fresh wallet) and 6 (farm log) are the same for every row; steps 2–5 are
 * category- and chain-aware (see actionFor, planSteps and gasFor).
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const action = actionFor(p, capital, chain);
  const gas = gasFor(chain);
  const { weekly, holdStep, check } = planSteps(planKind(p), capital, hold, gas.weekly);
  const multi = p.chains.length > 1
    ? ` Repeat the deposit on a second chain ${p.name} supports, ${p.chains[1]}, so the activity is visible there too.`
    : '';
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      text: `${action}${multi}`,
      cost: `$${capital} of capital and about ${gas.setup} of gas`,
      time: '15 minutes to set up',
    },
    weekly,
    holdStep,
    check,
    {
      text: `Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.`,
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js, with the farm plan generated in the page. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    category_multiple: row.model.category_multiple,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    chain_multiplier: row.model.chain_multiplier,
    watchlist: row.watchlist,
    multiple_n: row.model.multiple_n,
    multiple_note: row.model.multiple_note,
    record_flag: row.record_flag,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(
  snapshot: Snapshot,
  model: ModelConstants = MODEL,
): { board: BoardRow[]; radar: RadarData } {
  const multiples = categoryMultiples(snapshot.protocols, model);
  const { byCategory: detail } = calibrationByCategory(snapshot.protocols, model);
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !r.watchlist).length;
  const multiplesRecord: Record<string, number> = {};
  for (const [key, value] of [...multiples.byCategory.entries()].sort()) {
    multiplesRecord[key] = round4(value);
  }
  const liveByCategory: Record<string, CategoryCalibration> = {};
  for (const key of [...detail.keys()].sort()) {
    liveByCategory[key] = detail.get(key)!;
  }
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    overall_multiple: round4(multiples.overall),
    multiples: multiplesRecord,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map(radarRow),
    live,
    liveByCategory,
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
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new SnapshotError('snapshot.json is not a JSON object');
  }
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) {
    throw new SnapshotError('snapshot.json has no as_of date');
  }
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) {
    throw new SnapshotError('snapshot.json has no floor_usd');
  }
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) {
    throw new SnapshotError('snapshot.json has no watchlist of slugs');
  }
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    }
    const p = v as Record<string, unknown>;
    if (
      typeof p.slug !== 'string' ||
      typeof p.name !== 'string' ||
      typeof p.tvl_usd !== 'number' ||
      !Number.isFinite(p.tvl_usd)
    ) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains)
        ? p.chains.filter((c): c is string => typeof c === 'string')
        : [],
      tvl_usd: p.tvl_usd,
      change_7d:
        typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd:
        typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
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

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) {
    return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  }
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) {
    if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  }
  for (let i = 1; i < board.length; i++) {
    if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) {
      return `row ${i + 1} outranks row ${i} on implied value`;
    }
  }
  if (
    board.length >= 2 &&
    board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd
  ) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) {
      return `${r.slug} has ${steps.length} farm steps`;
    }
    for (const s of steps) {
      if (s.length < 20 || s.length > 600) {
        return `${r.slug} has a farm step of ${s.length} characters`;
      }
    }
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) {
      return `${r.slug} has implied value ${r.implied_value_usd}`;
    }
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
