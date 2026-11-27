# History screen design

Reference: user-supplied Spotify Design MD. This is a native product screen, so the pasted landing-page skill's hero, imagery, dual-theme, and marketing-section requirements do not apply. The user explicitly requested dark Spotify styling.

Dials: DESIGN_VARIANCE 4, MOTION_INTENSITY 3, VISUAL_DENSITY 7.

Rules and checks:
- Base #121212, surfaces #181818/#1f1f1f; no light sections. Check every root/modal surface.
- #1ed760 only for selected filters, active navigation, saved-workout day indicators and opening the latest workout. No decorative green panels.
- Buttons are pills/circles, cards 8px, date/art tiles 6px, sheets 20px. Check StyleSheet definitions.
- Titles max 24px; compact 700/400 weight hierarchy. Manrope is locally bundled, not Spotify's proprietary font.
- Neutral secondary text #b3b3b3. Green controls use #121212 text, not white.
- List-first phone layout, 24px horizontal inset, 600px maximum content width on tablets/web. Native safe areas handle notches and system navigation.
- Set details preserve full exercise names and source units. Search is case-insensitive; normalization groups whitespace/case only.
- Date-only records never receive fake midnight timestamps or durations. Missing RPE displays a hyphen.
- Only press feedback, no looping motion or animated scrolling. No motion preference dependency required.
- No remote photographs, trackers, credentials or invented workout records.

21st provenance:
- Read 21st-ui-build and 21st-cli-use SKILL.md.
- Ran `21st init --design-context`.
- `21st search 'react native tabs' --context auto` and `21st search tabs` returned HTTP 401. No registry code was downloaded.
- Public Button examples inspected at https://21st.dev/@shadcn/components/button (publicly indexed mirror: https://contact_2a72bbaa.21st.dev/%40shadcn/components/button). The public demo shows default, secondary, outline, icon, and disabled states with a shared Button API.
- Pill is an independently implemented native adaptation of that public API pattern, customized to the supplied pill geometry. It is not a verbatim copy or an official 21st native package.
- `21st review mobile/App.tsx mobile/src/components/Pill.tsx mobile/src/styles.ts`: 3 files, 0 findings.
