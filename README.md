# Launch Radar — Best Token Launch Radar

![make.fun token-radar-01](https://make.fun/badge/token-radar-01.svg)
![rank](https://make.fun/badge/token-radar-01/tuyullima311-cloud/launch-radar/rank.svg)
![reward](https://make.fun/badge/token-radar-01/tuyullima311-cloud/launch-radar/reward.svg)

An entry for make.fun's [Best Token Launch Radar](https://make.fun/bounty/token-radar-01) bounty.

Launch Radar ranks the protocols in the competition's sealed DefiLlama snapshot that record **no
token yet** by the value a token launch would carry if the protocol's record stayed as it is — and
gives each one a concrete, costed farm plan.

## How it prices

No protocol name is special-cased; one function prices every row from the snapshot's own figures:

- **Comps.** Every live protocol whose token trades contributes its market-cap ÷ TVL ratio. Each
  ratio is winsorized at the market-wide 90th percentile so one frothy token cannot price a whole
  category.
- **Base price.** TVL × the protocol's category multiple: the category's median ratio shrunk
  toward the global median, `used = (n × median + 8 × global) / (n + 8)`. The category's shrunk
  25th/75th percentiles give each row a value range.
- **Momentum.** Seven-day TVL change on a saturating curve, so one hot week cannot rule a ranking.
- **Maturity.** Longer running with no token prices higher, with diminishing returns.
- **Breadth.** Each extra chain adds a little reach, capped.

The board covers all 40 watchlist protocols and adds every other independent pre-token launch
candidate below the floor — 224 rows on this snapshot. Wrapped, staked, bridged, versioned and
exchange-own products are excluded from the radar's own additions: they are another protocol's
product, not a launch of their own.

## The dashboard

A static page with no network: the ranked board (search, category and chain filters, watchlist
toggle, sortable columns), a detail view per protocol showing the model's arithmetic factor by
factor plus the six-step farm plan, a live-tokens view with the comparable multiples the prices
come from, and a method view that states the model whole.

## Run it

Node 22.18+, standard library only:

```
mkdir -p out
MAKEFUN_OUTPUT_DIR=out node main.ts --input <path-to-snapshot.json>
```

Writes `board.json`, `data.js`, `dashboard/`, `screenshots/` and `dossier.json` (via the vendored
`vendor/makefun-board.ts`) into the output directory. Two runs on the same snapshot write identical
bytes.

## Layout

- `main.ts` — the program: snapshot in, board + dashboard data + dossier out, gate-shape self-check
- `lib/model.ts` — the comps model, the board builder and the farm-plan playbooks
- `vendor/makefun-board.ts` — make.fun's dossier library, vendored byte for byte
- `dashboard/` — the page (index.html, app.css, app.js)
- `screenshots/` — the board, a detail view and a filtered view

MIT licensed.
