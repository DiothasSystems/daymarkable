# Play listing assets

What Google Play asks for, where each piece comes from, and the one rule that governs all of it.

## The rule

**Nothing in a store listing may show real user content.** A listing is public, permanent, and
indexed; the founder's own account holds client names, roadmaps and colleagues' names. Screenshots
are taken against a fictional seeded account (`scratchpad/demo-seed.mjs`, not committed — it is a
throwaway) pointed at a local dev server, never against production.

That is also why the screenshots here are worth regenerating rather than reusing: when the UI
changes, re-seed and re-shoot, don't crop an old one.

## The assets

| Play field | File | Size | Made by |
| --- | --- | --- | --- |
| App icon | `../assets/play-store-icon.png` | 512×512, no alpha | `python scripts/app-icons.py` |
| Feature graphic | `feature-graphic.png` | 1024×500, no alpha | `python scripts/app-icons.py` |
| Phone screenshots | `screenshots/*.png` | 1008×2244 (Pixel 8 Pro) | the recipe below |

Play wants 2–8 phone screenshots, each between 320px and 3840px on a side with the long edge no
more than twice the short one. A 1008×2244 device capture satisfies that as-is; do not upscale.

The feature graphic carries no text of its own beyond the wordmark. Play overlays the app title on
several of its surfaces and crops the graphic differently on each, so the composition is centred
with wide margins and nothing near an edge that a trim would lose.

## Taking the screenshots

The app must be pointed at the machine running the seeded database, not production:

```powershell
node scratchpad\demo-seed.mjs                    # fictional account, prints a token
pnpm db:dev                                      # PGlite on :5433
pnpm --filter @daymarkable/web dev               # :3000
powershell -ExecutionPolicy Bypass -File scripts\android-build.ps1 -Install -ApiUrl "http://<this-machine-lan-ip>:3000"
```

Then, with the phone unlocked and connected:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\store-screenshots.ps1
```

That script puts the status bar into Android's demo mode (full battery, 9:30, no notification
clutter — the same thing Google's own listings do), walks the tabs, and writes the captures here.

**Afterwards, rebuild against production** so the device is not left holding a build that talks to
a laptop:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\android-build.ps1 -Install
```
