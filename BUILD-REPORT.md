# Build Report — Launch Radar (token-radar-01)

Built 16 Nov 2026 for make.fun's "Best token launch radar" bounty (deadline Mon 14 Dec 2026
17:00 WIB). Entrant: @tuyul-dua. The entry is a Node 22 program (`main.ts`, standard library only)
plus a static dashboard; it reads the kit's sealed DefiLlama snapshot and writes the ranked board,
the dashboard data, the dashboard, the screenshots and the dossier.

## Data source

Only the kit's sealed snapshot (`input/snapshot.json`, DefiLlama protocols endpoint fetched
2026-11-14T01:18:33Z, `as_of` 2026-11-14): 758 protocols at ≥ $5M TVL, 40 on the house watchlist,
floor $50,000,000. Nothing else is read; the program runs with no network and is deterministic —
two runs on the snapshot produce byte-identical output (verified by diffing two full runs).

## Ranking logic (lib/model.ts, model version `comps-2`)

Coverage first: **all 40 watchlist slugs are ranked, always**. Below the floor the radar adds every
other pre-token protocol that is an independent launch candidate — not a versioned deployment
(name version-marker rule), not an exchange's own product (category CEX or an exchange-name
prefix), and not a wrapped/staked/bridged product (whole-word name rule plus the product categories
CEX, Bridge, Canonical Bridge, Restaked BTC, Stablecoin Wrapper). Result: **224 rows** (40
watchlist + 184 early), 118 pre-token protocols left out as products/versions/exchange entries.

Each row's implied value is priced off the snapshot's own market:

1. **Comps.** 128 live protocols carry both a market cap and TVL; each gives a ratio mcap ÷ TVL.
   Every ratio is **winsorized at the market-wide 90th percentile (2.975x)** — without this, Rain
   (mcap $2.65B on $6.6M TVL, ratio ≈ 400x) single-handedly priced Prediction Market at a 66.9x
   multiple and put a $24B implied value on Polymarket; with it, Polymarket prices at $188M.
2. **Category multiple.** Per category: median ratio (global median 0.2138x), shrunk toward the
   global median with `used = (n × median + 8 × global) / (n + 8)`; shrunk p25/p75 give the row's
   range. Categories with no comps fall back to the global set.
3. **Adjustments.** Momentum: `1 + 0.55 × g / (|g| + 45)` on the 7-day TVL change clamped to
   −60%…+150% (range ≈ 0.69x–1.42x). Maturity: `0.78 + 0.38 × (1 − exp(−years / 1.6))`; an
   unreported listing date takes the candidate set's median known age (513 days). Breadth:
   `1 + 0.025 × min(chains − 1, 6)`.
4. **Implied value** = `round(TVL × multiple × momentum × maturity × breadth)`, ranked descending
   (ties: TVL, then slug). Max implied/TVL on the board is 0.70x — no row is priced above its own
   TVL by more than the evidence supports. Top of the board: Steakhouse Financial ($1.62B),
   Sentora Curator ($1.54B), Gauntlet ($1.01B) — all genuine pre-token protocols.

**Farm plans** are generated per row from its own record: a playbook for its category (14 groups:
lending, DEX, yield, bridge, trading, staking, RWA, stable, chain, launchpad, payments, insurance,
privacy, generic), a gas class for its first chain (Ethereum ≈ $14 setup / $6 weekly, Solana <
$0.10, Bitcoin ≈ $5, other chains ≈ $1 / $0.30), a capital ticket from its TVL ($50–$500), and a
hold window from its age (30–90 days). Six steps per row, each with an action, a cost and a time;
all steps measure 177–309 trimmed characters (gate: 20–600).

## Dashboard (dashboard/, 31,410 bytes of source — shown whole in the dossier)

Dark scope theme (ink panels, phosphor green, amber watchlist stars), system fonts only, zero
network references anywhere in the sources. Three views:

- **The board** — sortable columns (rank, TVL, 7d change, age, multiple, implied value), search,
  category and chain filters, watchlist-only toggle, live row count.
- **Detail view** per protocol — implied value with its range bar, the model's arithmetic factor
  by factor (multiple, comps behind it, momentum, maturity, breadth), the snapshot record, and
  the six-step farm plan with cost/time broken out.
- **Live tokens & comps** — the top 40 live tokens by market cap with their raw multiples, and
  the full category-multiples table the model prices from; plus a **Method** view stating the
  model whole. View state lives in the URL (`?detail=`, `?watch=1`, `?tab=`), which is also how
  the screenshots were taken.

Screenshots (1440×900 PNG, headless Chrome 157): `1-board.png` (214,905 B), `2-detail.png`
(268,629 B, Steakhouse Financial detail open), `3-filtered.png` (213,404 B, watchlist-only filter
active, "40 of 224 protocols"). Dossier totals 962 KB — under the 1.5 MiB gate cap with room.

## Verification (all run locally, 16 Nov 2026)

An independent checker re-derived every gate row from the program's output directory:

- dashboard_files: index.html + .css + .js present, 3 files / 31,410 B, plain names, and **no
  `http://` or `https://` string anywhere in the dashboard sources** — PASS
- board_file: 468,708 B, 224 rows, every slug real in the snapshot and unique, names non-empty,
  ranks positive, implied values whole dollars ≤ 1e14 — PASS
- sorted_by_value: ranks exactly 1..224, implied non-increasing by rank, not all equal — PASS
- coverage: all 40 watchlist slugs present — PASS
- farm_steps: every row 6 steps, each 20–600 trimmed chars — PASS
- screenshots: 3 PNGs, each ≤ 512 KiB, 1440×900 (long side 1440, short side 900 ≥ 800) — PASS
- dossier_matches: output `dossier.json` is byte-identical to a fresh
  `buildDossier(output, { text_max_bytes: 65536 })`, 962,241 B ≤ 1.5 MiB, and the dossier text
  contains no cut marker (dashboard source shown whole) — PASS
- determinism: two consecutive runs diffed recursively — identical — PASS
- rendering: board, detail, filtered, live and method views all screenshotted and eyeballed;
  fixes made from the screenshots (columns hidden when the detail panel opens, age label,
  a float artifact in the Method text) — PASS

The program also self-checks the board against the gate's shape before writing anything and
refuses to emit a dossier over the gate's 1.5 MiB.

## Rule ambiguities resolved

- **WBTC / USDT0 on the board?** The snapshot's WBTC record carries no token fields, so a naive
  pre-token test ranks it #2 — but the rules name WBTC and USDT0 as wrapped/bridged products of
  tokens that trade. Resolved by adding category `Bridge` to the product exclusions for the
  radar's *own additions* (the house's watchlist rule excludes Bridge for the same reason). The
  watchlist itself is always ranked as given (its one product-category member, Saturn, stays —
  coverage is a gate row).
- **"Pre-token" wording.** The dashboard says a protocol "records no token", never that it has
  none, per the rules' caution that DefiLlama's record is not proof.
- **Screenshot size.** The rules advise 300–350 KB; the gate enforces ≤ 512 KiB each and a
  1.5 MiB dossier. The PNGs are 213–269 KB (lossless, crisper text), dossier 962 KB — inside
  every enforced cap.
- **README badges.** `README.md` carries the competition's three live badges with `{owner}` /
  `{repo}` placeholders, exactly as the requirements' template starts; they must be replaced
  with the real GitHub owner/repo when the repository is created (the `repo_readme` check
  refuses placeholders).

## Remaining submission steps (for the entrant's side)

1. Create the public GitHub repository (after the competition's 2026-11-14 opening — any repo
   created now qualifies), push this package as the initial history, replace `{owner}` / `{repo}`
   in the README badge URLs, and set the repo's About: website = the make.fun competition page,
   topic `makefun`. `.makefun/owner.json` is already in the package, naming the linked wallet
   `4k8bbh3bLer1omg65QveXP3q4Gtnt4scVNmeBVWAE3ht`.
2. Bundle the build sessions' transcripts with the kit CLI and run
   `node cli/makefun.mjs check --kit . --repo <repo> --transcripts transcripts.tar.gz`.
3. Submit before **Mon 14 Dec 2026 17:00 WIB**; the final "Sign and submit" signature is the
   account holder's, from the browser holding the linked wallet.
4. Nothing here runs `makefun login` / `register` / `submit`, and no keypair was created or
   touched by this build.
