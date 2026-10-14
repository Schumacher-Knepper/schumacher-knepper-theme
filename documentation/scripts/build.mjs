// Generates the store guide (Markdown + PDF, one per language) from content.json.
//
//   node scripts/build.mjs           check content, write Markdown and PDFs
//   node scripts/build.mjs --no-pdf  Markdown only (no browser needed)
//   node scripts/build.mjs --sync    first add new screenshots to content.json as steps

import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONTENT_FILE = path.join(ROOT, 'content.json');
const SCREENSHOTS_DIR = path.join(ROOT, 'screenshots');
const OUTPUT_DIR = path.join(ROOT, 'output');
const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp'];
const PDF_IMAGE_MAX_WIDTH = 1800;

const args = new Set(process.argv.slice(2));
const warnings = [];

const content = JSON.parse(await readFile(CONTENT_FILE, 'utf8'));
const languages = Object.keys(content.languages);

// ---------------------------------------------------------------------------
// Screenshots: sync and validation
// ---------------------------------------------------------------------------

const leadingNumber = (name) => parseInt(name, 10) || 0;

function sentenceFromFilename(name) {
  const words = name
    .replace(/\.[^.]+$/, '')
    .replace(/^\d+-/, '')
    .replace(/[-_\s]+/g, ' ')
    .trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

async function listScreenshots() {
  const result = [];
  for (const dir of await readdir(SCREENSHOTS_DIR, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    for (const file of await readdir(path.join(SCREENSHOTS_DIR, dir.name))) {
      if (IMAGE_EXTENSIONS.includes(path.extname(file).toLowerCase())) result.push(`${dir.name}/${file}`);
    }
  }
  return result;
}

// Inserts a step after the last step whose screenshot number is lower or equal.
function insertStep(chapter, step) {
  const number = leadingNumber(step.image);
  let target = chapter.sections[0];
  let index = 0;
  for (const section of chapter.sections) {
    section.steps.forEach((existing, i) => {
      if (leadingNumber(existing.image) <= number) {
        target = section;
        index = i + 1;
      }
    });
  }
  target.steps.splice(index, 0, step);
}

async function syncScreenshots() {
  const referenced = new Set(
    content.chapters.flatMap((chapter) =>
      chapter.sections.flatMap((section) => section.steps.map((step) => `${chapter.folder}/${step.image}`))
    )
  );
  const added = [];

  for (const screenshot of await listScreenshots()) {
    if (referenced.has(screenshot)) continue;
    const [folder, image] = screenshot.split('/');

    let chapter = content.chapters.find((c) => c.folder === folder);
    if (!chapter) {
      chapter = { folder, title: { en: sentenceFromFilename(folder) }, sections: [{ steps: [] }] };
      const index = content.chapters.findIndex((c) => leadingNumber(c.folder) > leadingNumber(folder));
      content.chapters.splice(index === -1 ? content.chapters.length : index, 0, chapter);
    }

    insertStep(chapter, { image, text: { en: `${sentenceFromFilename(image)}.` } });
    added.push(screenshot);
  }

  if (added.length) {
    await writeFile(CONTENT_FILE, `${JSON.stringify(content, null, 2)}\n`);
    console.log(`Added ${added.length} new step(s) to content.json:\n  ${added.join('\n  ')}`);
    console.log('Review the English text and add the translations, then run the build again.\n');
  } else {
    console.log('No new screenshots to add.\n');
  }
}

async function validateScreenshots() {
  const onDisk = new Set(await listScreenshots());
  const referenced = new Set();
  const missing = [];

  for (const chapter of content.chapters) {
    for (const section of chapter.sections) {
      for (const step of section.steps) {
        const key = `${chapter.folder}/${step.image}`;
        referenced.add(key);
        if (!onDisk.has(key)) missing.push(key);
      }
    }
  }

  for (const screenshot of onDisk) {
    if (!referenced.has(screenshot)) warnings.push(`Screenshot not used in content.json: ${screenshot} (run with --sync to add it)`);
  }

  if (missing.length) {
    console.error(`content.json references screenshots that don't exist:\n  ${missing.join('\n  ')}`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Content helpers
// ---------------------------------------------------------------------------

// Returns the text in the requested language, falling back to English.
function translate(value, lang, where) {
  if (!value) return '';
  if (value[lang]) return value[lang];
  warnings.push(`Missing "${lang}" translation for ${where} (English used instead)`);
  return value.en ?? '';
}

// Resolves the guide for one language into a plain structure with step numbers.
function resolveGuide(lang) {
  const meta = content.languages[lang];
  return {
    lang,
    ...meta,
    chapters: content.chapters.map((chapter, chapterIndex) => {
      let stepNumber = 0;
      const where = (suffix) => `${chapter.folder} ${suffix}`;
      return {
        number: chapterIndex + 1,
        title: translate(chapter.title, lang, where('title')),
        intro: translate(chapter.intro, lang, where('intro')),
        sections: chapter.sections.map((section, sectionIndex) => ({
          title: translate(section.title, lang, where(`section ${sectionIndex + 1} title`)),
          intro: translate(section.intro, lang, where(`section ${sectionIndex + 1} intro`)),
          note: translate(section.note, lang, where(`section ${sectionIndex + 1} note`)),
          steps: section.steps.map((step) => ({
            number: ++stepNumber,
            image: `${chapter.folder}/${step.image}`,
            text: translate(step.text, lang, where(step.image)),
            tip: translate(step.tip, lang, where(`${step.image} tip`)),
            warning: translate(step.warning, lang, where(`${step.image} warning`)),
          })),
        })),
      };
    }),
  };
}

const stripInline = (text) => text.replace(/\*\*(.+?)\*\*/g, '$1').replace(/\*(.+?)\*/g, '$1');

// GitHub-style heading anchor.
const slug = (text) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s/g, '-');

// ---------------------------------------------------------------------------
// Markdown
// ---------------------------------------------------------------------------

function renderMarkdown(guide) {
  const imageHref = (image) => `../../screenshots/${image.split('/').map(encodeURIComponent).join('/')}`;
  const switcher = languages
    .map((lang) => (lang === guide.lang ? `**${content.languages[lang].name}**` : `[${content.languages[lang].name}](../${lang}/guide.md)`))
    .join(' · ');

  const lines = [
    '<!-- Generated by documentation/scripts/build.mjs from documentation/content.json. Do not edit by hand. -->',
    '',
    `# ${guide.title}`,
    '',
    switcher,
    '',
    guide.intro,
    '',
    `## ${guide.labels.contents}`,
    '',
    ...guide.chapters.map((chapter) => `${chapter.number}. [${chapter.title}](#${slug(`${chapter.number}. ${chapter.title}`)})`),
    '',
  ];

  for (const chapter of guide.chapters) {
    lines.push('---', '', `## ${chapter.number}. ${chapter.title}`, '');
    if (chapter.intro) lines.push(chapter.intro, '');

    for (const section of chapter.sections) {
      if (section.title) lines.push(`### ${section.title}`, '');
      if (section.intro) lines.push(section.intro, '');
      if (section.note) lines.push(`> **${guide.labels.note}:** ${section.note}`, '');

      for (const step of section.steps) {
        lines.push(`**${guide.labels.step} ${step.number}:** ${step.text}`, '');
        if (step.tip) lines.push(`> 💡 **${guide.labels.tip}:** ${step.tip}`, '');
        if (step.warning) lines.push(`> ⚠️ **${guide.labels.warning}:** ${step.warning}`, '');
        lines.push(`![${stripInline(step.text)}](${imageHref(step.image)})`, '');
      }
    }
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------

const escapeHtml = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const inlineHtml = (text) =>
  escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>');

function renderHtml(guide, images) {
  const callout = (kind, label, text) =>
    text ? `<p class="callout callout--${kind}"><strong>${escapeHtml(label)}:</strong> ${inlineHtml(text)}</p>` : '';

  const chapters = guide.chapters
    .map((chapter) => {
      const sections = chapter.sections
        .map((section) => {
          const steps = section.steps
            .map(
              (step) => `
                <figure class="step">
                  <p class="step__text"><span class="step__number">${escapeHtml(guide.labels.step)} ${step.number}</span> ${inlineHtml(step.text)}</p>
                  ${callout('tip', guide.labels.tip, step.tip)}
                  ${callout('warning', guide.labels.warning, step.warning)}
                  <img src="${images.get(step.image)}" alt="${escapeHtml(stripInline(step.text))}">
                </figure>`
            )
            .join('');
          return `
            <section>
              ${section.title ? `<h3>${inlineHtml(section.title)}</h3>` : ''}
              ${section.intro ? `<p>${inlineHtml(section.intro)}</p>` : ''}
              ${callout('note', guide.labels.note, section.note)}
              ${steps}
            </section>`;
        })
        .join('');
      return `
        <article class="chapter" id="chapter-${chapter.number}">
          <h2>${chapter.number}. ${inlineHtml(chapter.title)}</h2>
          ${chapter.intro ? `<p>${inlineHtml(chapter.intro)}</p>` : ''}
          ${sections}
        </article>`;
    })
    .join('');

  const toc = guide.chapters
    .map((chapter) => `<li><a href="#chapter-${chapter.number}">${inlineHtml(chapter.title)}</a></li>`)
    .join('');

  return `<!doctype html>
<html lang="${guide.lang}">
<head>
<meta charset="utf-8">
<title>${escapeHtml(guide.title)}</title>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; font: 10.5pt/1.5 -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; color: #1f1f1f; }
  h1 { font-size: 26pt; line-height: 1.2; margin: 0 0 12pt; }
  h2 { font-size: 17pt; margin: 0 0 10pt; padding-bottom: 6pt; border-bottom: 1.5pt solid #1f1f1f; }
  h3 { font-size: 12.5pt; margin: 18pt 0 8pt; break-after: avoid; }
  a { color: inherit; }
  .cover { min-height: 240mm; display: flex; flex-direction: column; justify-content: center; }
  .cover p { font-size: 12pt; color: #555; max-width: 130mm; }
  .cover h2 { font-size: 12pt; border: 0; margin-top: 24pt; padding: 0; text-transform: uppercase; letter-spacing: .08em; color: #555; }
  .cover ol { font-size: 13pt; padding-left: 18pt; }
  .cover li { margin: 4pt 0; }
  .chapter { break-before: page; }
  .step { margin: 0 0 16pt; break-inside: avoid; }
  .step__text { margin: 0 0 6pt; }
  .step__number { display: inline-block; font-weight: 700; font-size: 9pt; text-transform: uppercase; letter-spacing: .04em; background: #1f1f1f; color: #fff; padding: 1pt 6pt; border-radius: 3pt; margin-right: 4pt; }
  .step img { display: block; width: 100%; border: .75pt solid #d4d4d4; border-radius: 4pt; }
  .callout { margin: 0 0 8pt; padding: 6pt 9pt; border-left: 3pt solid; border-radius: 2pt; }
  .callout--note { border-color: #6b7280; background: #f3f4f6; }
  .callout--tip { border-color: #2563eb; background: #eff6ff; }
  .callout--warning { border-color: #dc2626; background: #fef2f2; }
</style>
</head>
<body>
  <header class="cover">
    <h1>${escapeHtml(guide.title)}</h1>
    <p>${inlineHtml(guide.intro)}</p>
    <h2>${escapeHtml(guide.labels.contents)}</h2>
    <ol>${toc}</ol>
  </header>
  ${chapters}
</body>
</html>`;
}

// Shrinks every screenshot once (shared by all languages) so the PDFs stay small.
async function prepareImages(browser, guide) {
  const page = await browser.newPage();
  const images = new Map();
  const all = guide.chapters.flatMap((c) => c.sections.flatMap((s) => s.steps.map((step) => step.image)));

  for (const image of all) {
    const file = path.join(SCREENSHOTS_DIR, image);
    const extension = path.extname(file).slice(1).toLowerCase().replace('jpg', 'jpeg');
    const source = `data:image/${extension};base64,${(await readFile(file)).toString('base64')}`;
    const resized = await page.evaluate(
      async (src, maxWidth) => {
        const img = new Image();
        img.src = src;
        await img.decode();
        const scale = Math.min(1, maxWidth / img.naturalWidth);
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.naturalWidth * scale);
        canvas.height = Math.round(img.naturalHeight * scale);
        const context = canvas.getContext('2d');
        context.fillStyle = '#fff';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.imageSmoothingQuality = 'high';
        context.drawImage(img, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL('image/jpeg', 0.85);
      },
      source,
      PDF_IMAGE_MAX_WIDTH
    );
    images.set(image, resized);
  }

  await page.close();
  return images;
}

async function writePdfs(guides) {
  let puppeteer;
  try {
    puppeteer = (await import('puppeteer')).default;
  } catch {
    console.error('Puppeteer is not installed. Run "npm install" inside documentation/, or use --no-pdf.');
    process.exit(1);
  }

  const browser = await puppeteer.launch();
  try {
    const images = await prepareImages(browser, guides[0]);
    for (const guide of guides) {
      const page = await browser.newPage();
      await page.setContent(renderHtml(guide, images), { waitUntil: 'load' });
      const file = path.join(OUTPUT_DIR, guide.lang, `schumacher-knepper-guide-${guide.lang}.pdf`);
      await page.pdf({
        path: file,
        format: 'A4',
        printBackground: true,
        margin: { top: '18mm', bottom: '20mm', left: '18mm', right: '18mm' },
        displayHeaderFooter: true,
        headerTemplate: '<span></span>',
        footerTemplate: `<div style="width:100%;font-size:8px;color:#888;padding:0 18mm;display:flex;justify-content:space-between;font-family:Helvetica,Arial,sans-serif"><span>${escapeHtml(guide.title)}</span><span>${escapeHtml(guide.labels.page)} <span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`,
      });
      await page.close();
      console.log(`  ${path.relative(ROOT, file)}`);
    }
  } finally {
    await browser.close();
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

if (args.has('--sync')) await syncScreenshots();
await validateScreenshots();

const guides = languages.map(resolveGuide);

console.log('Markdown:');
for (const guide of guides) {
  const file = path.join(OUTPUT_DIR, guide.lang, 'guide.md');
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, renderMarkdown(guide));
  console.log(`  ${path.relative(ROOT, file)}`);
}

if (!args.has('--no-pdf')) {
  console.log('PDF:');
  await writePdfs(guides);
}

if (warnings.length) {
  console.warn(`\n${warnings.length} warning(s):\n  ${[...new Set(warnings)].join('\n  ')}`);
}
