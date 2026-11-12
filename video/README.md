# Operation Headroom

48.5-second, 1920×1080, 30 fps Agent RAMsey explainer. The selected Blacksite Operative identity carries through six editable scenes. Spoken narration explains every scene; captions and graphics support the explanation. The synthetic narrator is HeyGen Voice’s public Roderic voice.

[Watch or download the finished MP4](../assets/ramsey-explainer.mp4) · [Text transcript](TRANSCRIPT.md) · [Storyboard](STORYBOARD.md)

## Open and edit

Use the installed **Hyperframes 0.8.214** CLI and the Hyperframes desktop app. No runtime dependency is added to RAMsey itself.

```sh
hyperframes open video
```

Or, from this folder:

```sh
hyperframes check
hyperframes render --fps 30 --quality delivery --workers 1 --low-memory-mode -o ../assets/ramsey-explainer.mp4
```

Use your approved installed Chromium browser if required by your environment, with `HYPERFRAMES_BROWSER_PATH`. No browser download is needed. Render output is deterministic at a given timestamp. The source uses bundled fonts and GSAP, with no render-time network calls.

The project is `index.html` plus six files under `compositions/`. Each scene owns one paused GSAP timeline. Hyperframes owns clip and audio playback. Scene starts: 0, 6.7, 13, 21.8, 28.7, 37.9 seconds. The video ends at 48.5 seconds, with room after the last spoken word.

## Sound source and rights

`assets/score.mp3` is an original, intentionally synthesized score. `scripts/score.py` generates its source using the Python standard library. The script's docstring gives the FFmpeg normalization/encoding command. No third-party recording or sample is included.

Barlow Condensed and DM Sans ship with their SIL Open Font Licenses in `assets/`. GSAP 3.14.2 retains its license notice; see `vendor/GSAP-NOTICE.md`. Motion Studio M-10 and M-27 recipes inspired the depth card and parallax entrances; adaptations use RAMsey’s colors and actual capabilities. [Motion Studio](https://motionstudio.dreytools.com).

## Safe hands-on exercise

1. Run `ramsey status` to learn whether monitoring is installed and fresh.
2. Run `ramsey check --no-history --samples 1 --interval 1 --json` for a bounded read-only sample.
3. Explain the difference between memory pressure and summed RSS using the README. Do not interrupt an app.
4. Inspect `ramsey preflight --help`, then supply a budget only if you know it. Missing capacity is not a go result.

The example 4 GiB / 2-core job in scene four is a labelled example, not a measured requirement or a live recommendation.

Narration script: `NARRATION.txt`. `assets/narration-words.json` contains provider word timings; `captions.vtt` and the single caption track hold each complete spoken scene for accessible reading. The voice is not a clone of a private person.
