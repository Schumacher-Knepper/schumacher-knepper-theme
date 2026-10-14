# Store guide

The Schumacher-Knepper store guide, in English, French, German and Luxembourgish.

| Language | Markdown | PDF |
| --- | --- | --- |
| English | [guide.md](output/en/guide.md) | [PDF](output/en/schumacher-knepper-guide-en.pdf) |
| Français | [guide.md](output/fr/guide.md) | [PDF](output/fr/schumacher-knepper-guide-fr.pdf) |
| Deutsch | [guide.md](output/de/guide.md) | [PDF](output/de/schumacher-knepper-guide-de.pdf) |
| Lëtzebuergesch | [guide.md](output/lb/guide.md) | [PDF](output/lb/schumacher-knepper-guide-lb.pdf) |

## How it works

```
documentation/
├── content.json      # single source of truth: all text (4 languages) + screenshot names
├── screenshots/      # one folder per chapter, files numbered in step order
├── scripts/build.mjs # generator
└── output/           # generated, don't edit by hand
    └── <lang>/guide.md, schumacher-knepper-guide-<lang>.pdf
```

`content.json` holds chapters → sections → steps. Each chapter maps to a screenshot folder (`folder`), and each step names its screenshot (`image`). Step numbers are computed automatically.

Every piece of text is an object with one entry per language. Inline `**bold**` and `*italic*` are supported:

```json
{
  "image": "24-fill-all-the-fields.png",
  "text": { "en": "Fill in all the fields.", "fr": "…", "de": "…", "lb": "…" },
  "tip": { "en": "Optional blue callout", "fr": "…" },
  "warning": { "en": "Optional red callout", "fr": "…" }
}
```

Sections can also have an optional `intro` (a paragraph) and an optional `note` (a grey callout). Chapters can have an optional `intro`.

A missing translation falls back to English, and the build prints a warning for it.

## Updating the guide

First-time setup (downloads a headless Chrome for the PDFs):

```bash
npm --prefix documentation install
```

**Change some text:** edit `content.json`, then rebuild:

```bash
npm run docs
```

**Add a new step:**

1. Drop the screenshot into the right chapter folder, numbered for its position (for example `screenshots/3-translations/2-choose-the-language.png`).
2. Run the sync. It adds the screenshot to `content.json` as a new step, with English text taken from the file name, then rebuilds:

   ```bash
   npm run docs:sync
   ```

3. Polish the English text in `content.json`, add the `fr`/`de`/`lb` translations, and run `npm run docs` again.

A new screenshot folder (for example `4-discounts`) becomes a new chapter.

Other commands, run inside `documentation/`:

- `npm run build:md` regenerates the Markdown only, which is fast and doesn't need Chrome.
- Every build checks that each screenshot referenced in `content.json` exists. It also warns about screenshots that aren't used yet.
