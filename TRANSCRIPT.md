# Transcript — how Launch Radar was built

A readable summary of the build session for the token-radar-01 entry. (The graded transcript is
the agent session bundle produced by the kit's `bundle` command at submission time; this file is
the human-readable companion, as in the earlier entries.)

## Session outline — Mon 16 Nov 2026 (WIB), one build session

1. **Kit intake.** Downloaded the kit from `https://make.fun/c/token-radar-01/kit`, preserved it
   at `~/workspace/makefun/work/kit/token-radar-01-kit/`, and read `RULES.txt` in full (88 KB):
   deliverables, the seven gate rows, the judge's five criteria, the transcript gate, and the
   submission routes. Read `input/README.md`, `kit.json`, the starter's `main.ts` and
   `lib/model.ts`, and the vendored `vendor/makefun-board.ts` to learn the exact I/O contract
   (`--input`, `MAKEFUN_OUTPUT_DIR`, `buildDossier` caps).
2. **Snapshot analysis.** Profiled the sealed snapshot with Node one-liners: 758 protocols, 342
   pre-token / 416 live, watchlist 40; TVL bands per group; the live mcap/TVL distribution per
   category (global median 0.214x, p25 0.048x, p75 1.057x, n = 128); category and chain census.
   Found that one watchlist member (Saturn, Stablecoin Wrapper) fails any product filter —
   coverage must therefore be unconditional for watchlist slugs.
3. **Model design.** Chose a comps model over the starter's flat 0.25x: category mcap/TVL
   multiples from the snapshot's own live protocols, shrunk to the global median, with saturating
   momentum, exponential maturity and capped breadth adjustments; farm plans from 14 category
   playbooks parameterized by chain fee class, TVL-sized capital and age-sized hold windows.
4. **First implementation.** Copied `vendor/makefun-board.ts` byte-identically (sha256
   `9ca51b6e…`) and the MIT LICENSE; wrote `lib/model.ts` (~35 KB) and `main.ts` from scratch;
   wrote the dashboard (`index.html`, `app.css`, `app.js`) in a dark scope theme with board /
   detail / live-comps / method views and URL-param state.
5. **First run — two defects found and fixed.**
   - *WBTC ranked #2* ($2.85B implied): its snapshot record carries no token fields, but it is a
     wrapped product of a trading token (the rules name it). Fixed by adding category `Bridge`
     to the product exclusions for the radar's own additions.
   - *Prediction Market priced at 66.9x*: a single comp (Rain, ratio ≈ 400x) dominated even
     after shrinkage, giving Polymarket a $24B implied value. Fixed by winsorizing every comp
     ratio at the market-wide 90th percentile (2.975x).
   - Hardened shrinkage K from 5 to 8 after seeing three categories priced off one capped comp
     each; final max implied/TVL on the board: 0.70x.
6. **Screenshots.** Extracted Chrome 157 from the downloaded .deb, rendered the preview build
   headlessly at 1440×900 and took the board, detail (Steakhouse Financial) and filtered
   (watchlist-only) shots. Eyeballing them produced three fixes: hide the Age/Multiple columns
   while the detail panel is open (the implied column was clipped), a cleaner age label
   ("1.5y", not "1.0y+"), singular "1 live token", and a float artifact ("+15.000000000000002%")
   in the Method text. Also verified the Live and Method views render.
7. **Verification.** Ran `main.ts` twice into separate output dirs — recursive diff identical.
   Wrote an independent checker (`~/workspace/makefun/work/verify.mjs`) re-deriving all seven
   gate rows from the output: every row PASS, including byte-identical dossier reconstruction
   and full watchlist coverage. Assembled the package at `~/workspace/makefun/token-radar/`
   (code, dashboard, screenshots, LICENSE, `.makefun/owner.json`, README, this file,
   BUILD-REPORT) and smoke-tested the package copy itself.

## Files written by the session

- `lib/model.ts`, `main.ts` — the model and the program (authored in full, revised in steps 5–6)
- `dashboard/index.html`, `dashboard/app.css`, `dashboard/app.js` — the page (authored, revised
  after screenshot review)
- `screenshots/1-board.png`, `2-detail.png`, `3-filtered.png` — captured from the page itself
- `README.md`, `BUILD-REPORT.md`, `TRANSCRIPT.md` — repository documents
- Vendored unchanged: `vendor/makefun-board.ts`, `LICENSE` (from the kit's starter)
