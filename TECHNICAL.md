# Sounding Home — Technical Notes

Practical documentation for maintaining this site: how it's built, how
to add sounds, and how to deploy changes. For the project's artist
statement, see [`README.md`](README.md).

## Project structure

```
index.html
css/style.css
js/app.js               — drag & drop, audio graph, recording, exports
js/wav-encoder.js       — tiny AudioBuffer → WAV encoder
js/zip-encoder.js       — tiny dependency-free ZIP writer
assets/house.png        — the hand-drawn house
documents/               — PDFs and other documents linked from the site
sounds/archive.json     — the archive's playlist + research notes
sounds/*.wav            — the actual recordings
```

## Adding sounds to the archive

1. Put your audio file (WAV or MP3) in `sounds/`.
2. Add a line for it in `sounds/archive.json`:

```json
{
  "id": "unique-id",
  "title": "what a visitor sees",
  "file": "your-file.wav",
  "date": "",
  "location": "",
  "weather": "",
  "notes": ""
}
```

Only `id`, `title`, and `file` are used by the site itself — `date`,
`location`, `weather`, and `notes` are just there for your own record
keeping (they're never shown to visitors). Add, remove, or leave any of
them blank freely; the site only reads what it needs.

No code changes, no build step — just edit the JSON and drop the file in.

## A note on file size

Sounds load on demand, so the *initial page load* stays fast no matter
how large your archive gets — only the one sound someone actually drags
in gets downloaded. The size that matters is per-file: a bigger file
just means a longer "loading…" moment the first time that particular
sound is used in a visit. As a rough guide, a 10MB file might take a
couple of seconds on decent broadband, longer on a weak connection. If
you're trimming or converting from a high-resolution field recording, a
command like this works well:

```bash
ffmpeg -i original.wav -ar 44100 -c:a pcm_s16le -t 30 sounds/trimmed.wav
```

(`-t 30` trims to the first 30 seconds — drop it to keep the full length,
or add `-ss 00:00:10` to start partway in.)

## Running locally

Any static file server works, since the page fetches `sounds/archive.json`
and the audio files with `fetch()`, which most browsers block from
`file://` URLs. From the project folder:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

## Deploying to GitHub Pages

1. Push this folder to a GitHub repository.
2. In the repo, go to **Settings → Pages**.
3. Under **Build and deployment**, set **Source** to `Deploy from a branch`,
   pick your default branch and the `/ (root)` folder.
4. Save — GitHub will publish the site at
   `https://<your-username>.github.io/<repo-name>/`.

No further configuration is needed; there's no build step to run.

## Direct links to a specific sound

You can link straight to a pre-placed sound — handy for footnotes, a
thesis, or anywhere you want a reader to land with a specific listening
experience already set up, instead of finding and dragging it themselves.

```
https://your-username.github.io/your-repo/?sound=black-woodpecker&vol=70&reverb=30
```

- **`sound`** — the sound's `id`, exactly as written in `sounds/archive.json`.
- **`vol`** — 0–100, how loud (0 = quiet/top of the house, 100 = loud/bottom). Optional, defaults to 50.
- **`reverb`** — 0–100, how much echo (0 = dry/right side, 100 = full echo/left side). Optional, defaults to 50.

When someone opens a link like this, the sound appears already placed in
the house at that position. Browsers won't let audio play automatically
with zero interaction, so if it can't start on its own, a small "tap to
listen" button appears — one tap and it plays. From there the reader can
still drag it around like normal.

## Editing the copy

All the site's text lives directly in `index.html` — there's no CMS or
template layer. Just edit the paragraphs under the title directly in the
file.

## Notes on how it works

- Sounds load lazily: opening the site only fetches the lightweight
  `archive.json` list — an individual recording is only downloaded and
  decoded the moment someone actually drags it into the house (or a direct
  link requests it). This means the archive can hold as many or as large
  recordings as you like without slowing down the initial page load; the
  cost of a large file only lands on visitors who actually use that sound,
  and only the first time in their visit (after that it's cached in memory).
- While a sound is loading, its pin appears right away with a dashed,
  pulsing outline and a "loading…" label, so dragging still feels
  responsive even though nothing plays yet. If a sound fails to load (bad
  connection, wrong filename in `archive.json`), the pin switches to a
  "failed to load" state instead — remove it and drag it in again to retry.
- Downloading a composition only bundles sounds that finished loading
  successfully; if something's still loading or failed, the status line
  says so rather than the download silently including a blank sound.
- Each placed sound gets its own gain node for volume and a wet/dry split
  that feeds a single shared `ConvolverNode` (the reverb), so the mix stays
  light even with three sounds looping at once.
- Sounds start playing the instant they're dropped — there's no separate
  "start" button to click.
- The 20-second download is rendered with an `OfflineAudioContext`, using
  the exact same buffers and gain values as the live preview, so what you
  hear while placing sounds matches what you download.
- Dragging is implemented with Pointer Events, so it works with mouse,
  trackpad and touch alike.
- Downloading the mix produces a single `.zip` containing the 20-second
  WAV and the JSON field notes together. The ZIP is assembled by a small
  dependency-free encoder (`js/zip-encoder.js`, stored/uncompressed
  entries) — no external library needed.
- The house is `assets/house.png` — a real drawing with the white
  background made transparent. To swap in a new drawing, replace that file
  and adjust the `#dropzone` position in `index.html` (it's a simple
  percentage-based rectangle: `left`/`right`/`top`/`bottom`) so it still
  lines up with the walls.

## License

MIT — see `LICENSE`. Use it, remix it, teach with it.
