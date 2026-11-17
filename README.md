# Token Radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/Gustronger/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/Gustronger/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar: a ranked board of the pre-token protocols in a sealed
DefiLlama snapshot, each scored by its implied launch value, with a farm plan
for every row. Built for the [make.fun](https://make.fun) bounty
`token-radar-01` (Build the best token launch radar).

## What it ranks

The snapshot is the DefiLlama protocol index as of 2026-11-14: 758 protocols,
40 of them on the house watchlist (at least $50M of TVL and no token on
record). The board ranks **227 pre-token protocols**: the whole watchlist plus
every other pre-token protocol the snapshot can score. A protocol "records no
token" when the snapshot carries no market cap, no CoinGecko id and no symbol
for it — never a claim that it has none.

Bridges, exchange products, versioned pools and wrapped or staked receipts are
not ranked: their token already exists by construction, so there is no launch
to rank. Liquid staking stays in — staking protocols do launch tokens of
their own — unless the name itself says it is a wrapped or staked receipt.

## The model (radar-3)

Each protocol's implied value is its TVL times a category multiple, times a
growth multiplier, times a maturity multiplier, times a chain multiplier:

```
implied = round(tvl_usd
  x category multiple
  x (1 + clamp(change_7d, -50, 100) / 100 x 0.4)
  x (0.6 + min(age_days, 1095) / 1095 x 0.4)
  x (1 + 0.03 x min(chains - 1, 5)))
```

The category multiple is the median market-cap / TVL of the live-token
protocols in that category, winsorized to [0.005, 3.0] and shrunk toward the
overall median (0.246x) with a prior of 3 at every comp count:
`multiple = (n x median + 3 x 0.246) / (n + 3)`. A 1-comp category at 2.97x
lands near 0.93x, a 2-comp category at 0.013x near 0.15x — the comps pull the
multiple part-way instead of snapping to the overall median, while a single
outlier still cannot set a category on its own. Every row carries its comp
count (`multiple_n`) and a note such as "n=3, median 0.169x, shrunk to
0.207x", so a multiple built on one comp reads as low-confidence rather than
as a measurement. Categories with no live comps at all take the overall
median and say so ("n=0, no live comps"). Every multiple is clamped to
[0.02, 1.50]. Age is the time since the protocol was first listed; an
unlisted age uses 365 days.

Three rows carry a record-check flag (`record_flag`): USDD, Bittensor dTAO
and Plume Vaults record no token in the snapshot, but their tokens already
trade (USDD is a stablecoin — the token is USDD itself; TAO trades; PLUME
trades). USDD and dTAO are on the house watchlist and cannot be removed, so
the flag is the fix: the rows keep exactly the value the model computes, and
the dashboard shows the flag as a badge with a note instead of stamping them
"no token".

The top of the board: Steakhouse Financial ($2,326M implied), Sentora Curator
($2,108M), Gauntlet ($1,375M), Polymarket International ($298M), Nonce Capital
($291M).

An implied value is this entry's own claim about what a launch would be worth
if the record stayed as it is — never a prediction that a token is issued, or
when.

## Calibration

The multiples below are the medians the snapshot itself yields: market cap /
TVL of the live-token protocols in each category, winsorized to [0.005, 3.0]
and shrunk toward the overall median with a prior of 3. The overall median
across the snapshot's 119 live-token protocols is **0.246x**. `n` is the
number of live comps in the category.

| Category | n | Multiple |
| --- | --- | --- |
| AI Agents | 2 | 0.389x |
| Basis Trading | 7 | 0.532x |
| Bridge | 6 | 0.453x |
| CDP | 3 | 0.207x |
| Canonical Bridge | 8 | 0.610x |
| Chain | 1 | 0.934x |
| Collateral Management | 1 | 0.934x |
| Cross Chain Bridge | 4 | 0.803x |
| DOR | 1 | 0.207x |
| Decentralized AI | 1 | 0.700x |
| Derivatives | 2 | 1.012x |
| Dexs | 11 | 0.322x |
| Dual-Token Stablecoin | 1 | 0.192x |
| Indexes | 3 | 0.197x |
| Launchpad | 1 | 0.217x |
| Lending | 15 | 0.151x |
| Leveraged Farming | 1 | 0.228x |
| Liquid Restaking | 2 | 0.221x |
| Liquid Staking | 9 | 0.092x |
| Liquidity Manager | 1 | 0.188x |
| NFT Marketplace | 1 | 0.685x |
| Onchain Capital Allocator | 2 | 0.153x |
| Options | 1 | 0.563x |
| Payments | 2 | 0.220x |
| Prediction Market | 1 | 0.934x |
| Privacy | 3 | 0.608x |
| RWA | 9 | 0.268x |
| Restaking | 2 | 0.157x |
| Risk Curators | 1 | 0.928x |
| Staking Pool | 2 | 0.150x |
| Token Locker | 2 | 0.761x |
| Yield | 9 | 0.205x |
| Yield Aggregator | 4 | 0.192x |

Fourteen of the board's categories have no live comps at all (among them
CDP Manager, CeDeFi, Farm, Insurance and Restaked BTC) and take the overall
median 0.246x; only 20 of 227 rows sit on it now, down from 107 under the
old hard fallback. Risk Curators (1 live comp, api3 at 2.97x) lands at
0.928x and Onchain Capital Allocator (2 live comps, 0.006x and 0.019x) at
0.153x — the comps pull the multiple part-way, so one outlier cannot set a
category on its own. Every multiple is clamped to [0.02, 1.50]. The
dashboard's dataset also ships the real calibration set per category
(`liveByCategory`: up to 5 live comps by market cap with raw and winsorized
ratios, plus n, medians and multiple), so the detail view shows the comps
that set the multiple instead of the top-24-by-market-cap table.

Growth is the 7-day TVL change clamped to [-50, 100] and weighted 0.4, so a
hot week lifts a row but cannot double it. Maturity rewards age up to three
years and then stops (0.6 + min(age, 1095) / 1095 x 0.4; unknown age 365
days). Chain diversity adds 3% per extra chain up to five, capped at 1.15.

## Farm plans

Every row carries a six-step farm plan, derived from the protocol's own
record — its category, its chains, its TVL and its age. A protocol on more
than one chain gets a multi-chain second step; a young protocol's plan leans
on the basics, an old one's on depth. Steps 3–5 are category-aware: perps
get a hedge/funding cadence and a close-out (never a 30-day hold), prediction
markets get market selection and resolution tracking, RWA gets term and
redemption, staking/restaking gets receipt and reward cadence with no borrow
leg, curator vaults get vault selection and share tracking, and CDP rows get
mint-and-hold against collateral (USDD: mint USDD, no USDC-supply-and-borrow
leg). Gas is chain-aware — Ethereum about $5, Tron about $2, Solana about
$0.01, Binance about $0.30, other chains about $0.10 a transaction. Each
step is 20–600 characters. No step promises an airdrop or a token: the plan
says what to do so the activity is on record if the protocol ever rewards it.

## Reading the board

Sort by implied value, or by any column; filter by category, by chain, or by
scope (watchlist vs early). A row's badge says whether it is on the house
watchlist or an early find. Opening a row shows the full model breakdown —
every multiplier next to the number it produced — the live-token
comparables that set its multiple, and its farm plan. The Multiple column
recomputes from the board's own figures, so the detail view always shows
the same number board.json carries.

## The dashboard

`dashboard/` is a static page (no framework, no network): a sortable, searchable
board with category, chain and watchlist filters; a per-protocol detail view
with the full model breakdown, the live-token comparables that set its
multiple, and its farm plan; a live-token view of the protocols that already
trade; and a methodology section with the calibration table. Every farm plan
is derived from the protocol's own record (category, chains, TVL, age) and
never promises an airdrop — it says what to do so the activity is on record
if the protocol ever rewards it.

## Run it

Node 22 or newer, standard library only:

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json|directory>
```

It writes `out/board.json` (the ranked board), `out/data.js` (the dashboard's
dataset), `out/dashboard/` (the page), `out/screenshots/` (the three views)
and `out/dossier.json` (the summary the judge reads). The run is
deterministic: the same snapshot always writes the same bytes.

## Layout

- `main.ts` — entry point: read the snapshot, score it, write the outputs.
- `lib/model.ts` — the radar-3 model, the farm plans and the gate checks.
- `dashboard/` — the static page (`index.html`, `app.js`, `app.css`).
- `screenshots/` — the board, a detail view and a filtered view.
- `vendor/makefun-board.ts` — the make.fun dossier builder (vendored).
- `.makefun/owner.json` — the claim file for this entry's wallet.

## License

MIT. See `LICENSE`.
