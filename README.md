# Feral Futures: companion page

The page participants keep open next to Zoom during **Feral Futures: Draw Your Wild Card for 2027**. It holds the cards, the writing prompts and their answers, and ends as take-home field notes.

Plain HTML, CSS and JavaScript. No build step, no backend, no tracking. Answers stay in the participant's own browser.

## Run it

- **Locally:** double-click `index.html`. That's it.
- **With a local server** (closer to how it behaves when hosted):
  `python3 -m http.server` in this folder, then open http://localhost:8000
- **Hosted:** upload the folder as static files (GitHub Pages, Netlify, anything). `index.html` is the entry point.

## Files

| File | What it is |
|---|---|
| `index.html` | The page shell. |
| `styles.css` | All styling. **Design tokens are at the top.** |
| `app.js` | State, screens and behaviour. |
| `cards.json` | **All card and list content.** The single source of truth. |
| `cards.js` | Generated copy of `cards.json`, used when the page is opened from disk. Don't edit by hand. |
| `scripts/build-cards.py` | Regenerates `cards.js`. |
| `assets/` | Card images go here. |
| `Prompt/` | The original build brief and reference files. Local only (git-ignored), not used by the page. |

## Edit the content

1. Edit `cards.json`.
2. Regenerate the fallback:

   ```
   python3 scripts/build-cards.py
   ```

   It also checks `cards.json` for typos and tells you the line if something's broken.

When the page is hosted, it reads `cards.json` directly. `cards.js` only matters when someone opens `index.html` from disk (browsers block `fetch` there). Regenerate it anyway so the two never drift.

Notes:
- The tame screen shows 3 random rules (from those with `"show": true`) as examples, and the try screen shows 4 random ways. They're picked fresh each time the page loads. This is a placeholder until a curated set exists (see `pickExamples` in `app.js`).
- A world's "This already exists" panel only appears when `example` isn't `null`.
- Twist names that start with "It's" become "Now make it …". Others use "Add the twist: …".
- Changing an `id` means anyone mid-session loses that particular choice (their writing is kept).

### Adding card images

Put the file in `assets/` and set `image` in `cards.json`, for example:

```json
"image": "assets/creatures/feral-pigeon.webp"
```

Images should be 5:7 portrait (e.g. 1000 × 1400). When `image` is set, the image fills the card front with the card's name over it, everywhere that card appears. The card component handles creatures, worlds and twists the same way, so the other decks will take an `image` field too.

The creatures currently use **placeholder photos from Unsplash** (linked from images.unsplash.com, uncredited because they're for internal review only). Replace them with Sam's art by changing `image` to a local path.

### Card motion

Tapping a creature enlarges the card and turns it over, animated with [GSAP](https://gsap.com) (loaded from cdnjs in `index.html`; free for commercial use). If GSAP doesn't load, or someone has reduced motion switched on, the card simply appears turned over. The code is `openCreature` / `closeCreature` in `app.js`.

## Design tokens

The `:root` block at the top of `styles.css` holds everything Sam's style guide will replace:

- Colours: `--color-bg`, `--color-ink`, `--color-muted`, `--color-accent` (plus a few supporting ones)
- Deck colours: `--deck-creature`, `--deck-world`, `--deck-twist`
- Fonts: `--font-display`, `--font-body`
- Corners: `--radius-card`
- Spacing and type sizes

To add web fonts: add the `@font-face` rules (or a font `<link>` in `index.html`) and update `--font-display` / `--font-body`. Card backs are placeholder CSS patterns under `.card--back` in `styles.css`. Swap them for images when they exist.

## The idea pile (part 2)

Part 2 is a play table, not a step-by-step flow: creature, world and twist sit side by side, can be redrawn or swapped any time, and every idea goes on a pile tagged with the cards that were in play. The prompt above the idea box is built from the cards on the table (`cardPrompt` in `app.js`). People star the ones that spark something.

In part 3 they pick the idea or two they want to take with them from the pile, and write a small move for each. The field notes keep the whole pile plus those takeaways.

## Links

The "What's next" links live in `CONFIG.links` at the top of `app.js`. The newsletter is set; the deck link is a `#` placeholder.

## How answers are saved

Everything is saved in `localStorage` under the key `feral-futures`, with a `version` number. It's saved on every keystroke, so refreshing never loses anything. "Start over" (bottom of every screen) clears it after a confirm.

If you change the shape of the saved data later, bump `CONFIG.stateVersion` in `app.js` and add a step to `MIGRATIONS` so people keep their answers.

Each screen also has its own address (`index.html#world`, `#notes`, ...), so the browser's back button works and you can link straight to a screen.
