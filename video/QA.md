# Media verification

The final film is 48.5 seconds at 1920×1080 and 30 fps. It includes spoken narration, original background score and one caption track. Narration timing drives the six scenes.

- Assembled Hyperframes check: no errors or warnings in lint, runtime, layout, motion, contrast, craft or audio. Two informational SVG-connector findings remain: the process map is a schematic with a branch junction rather than DOM boxes at every endpoint. Visual inspection confirms the lines attach to the intended boxes.
- Six scene stills were inspected for legibility, work-protection claims and example labels. Caption placement was revised to avoid the command and proof line.
- Repeat snapshots at 10.5 seconds produced identical SHA-256 hashes before narration was added; motion remains on the same deterministic paused timelines.
- Public synthetic narrator: HeyGen Voice, Roderic. Source text and provider word timings are included. No private voice clone or third-party recording is used.
- Music uses native Hyperframes EQ cuts at 180 Hz and 1 kHz plus lower gain to give speech room. The optional automatic carve helper required an unavailable package; no dependency was installed. Static EQ is the implemented fallback.

Final rendered-stream and loudness verification is recorded with the release. Source and rendered output are distinct checks; a valid source alone does not prove audible narration.

Final native audio QC: -13.1 LUFS integrated, -1.9 dBTP true peak, zero clipped samples. Video and audio streams both 48.500 seconds. Rendered narration matches the supplied voice at 0.000-second offset (speech-band correlation 0.99947). Scene loudness spread is 1.11 LU. No dead-air or ending blocker. Automated ASR wording verification was not performed.

The fast sound-design critique was partial (18/21 metrics); transitions at 21.8 and 37.9 seconds carry continuous voice and music rather than new accent hits. This is a voice-led continuous score, not a claim of a hit on every visual cut.
