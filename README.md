# Token Radar

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

## The model (radar-2)

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
overall median (0.246x). A category with fewer than 3 live comps takes the
overall median outright, so one legacy deployment cannot set a multiple on its
own. Every multiple is clamped to [0.02, 1.50]. Age is the time since the
protocol was first listed; an unlisted age uses 365 days.

The top of the board: Steakhouse Financial ($617M implied), Sentora Curator
($559M), Gauntlet ($364M), Veda ($355M), USDD ($189M).

An implied value is this entry's own claim about what a launch would be worth
if the record stayed as it is — never a prediction that a token is issued, or
when.

## Calibration

The multiples below are the medians the snapshot itself yields: market cap /
TVL of the live-token protocols in each category, winsorized to [0.005, 3.0]
and shrunk toward the overall median with a prior of 3. The overall median
across the snapshot's 120 live-token protocols is **0.246x**.

| Category | Multiple |
| --- | --- |
| Dexs | 0.322x |
| Lending | 0.151x |
| Liquid Staking | 0.092x |
| RWA | 0.267x |
| CDP | 0.207x |
| Basis Trading | 0.532x |
| Every other category | 0.246x (the overall median) |

Risk Curators (1 live comp) and Onchain Capital Allocator (2 live comps) fall
back to the overall median: with fewer than 3 live comps a category takes
the overall median outright, so a single legacy deployment cannot set a
multiple on its own — one outlier, api3 at 2.98x, would otherwise have set
its whole category. Every multiple is clamped to [0.02, 1.50].

Growth is the 7-day TVL change clamped to [-50, 100] and weighted 0.4, so a
hot week lifts a row but cannot double it. Maturity rewards age up to three
years and then stops (0.6 + min(age, 1095) / 1095 x 0.4; unknown age 365
days). Chain diversity adds 3% per extra chain up to five, capped at 1.15.

## Farm plans

Every row carries a six-step farm plan, derived from the protocol's own
record — its category, its chains, its TVL and its age. A protocol on more
than one chain gets a multi-chain second step; a young protocol's plan leans
on the basics, an old one's on depth. Each step is 20–600 characters. No
step promises an airdrop or a token: the plan says what to do so the
activity is on record if the protocol ever rewards it.

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
- `lib/model.ts` — the radar-2 model, the farm plans and the gate checks.
- `dashboard/` — the static page (`index.html`, `app.js`, `app.css`).
- `screenshots/` — the board, a detail view and a filtered view.
- `vendor/makefun-board.ts` — the make.fun dossier builder (vendored).
- `.makefun/owner.json` — the claim file for this entry's wallet.

## License

MIT. See `LICENSE`.
