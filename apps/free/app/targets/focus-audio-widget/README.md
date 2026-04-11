# Focus Audio Widget

This directory is the source of truth for the iOS Focus Audio home screen widget.

## Maintenance model

- Edit files here, not in `ios/`.
- The Xcode target is regenerated from this folder by `@bacons/apple-targets` during Expo prebuild.
- `app.config.js` intentionally limits the plugin to `match: 'focus-audio-widget'` so other unfinished Apple targets under `targets/` are not pulled into the generated iOS project.

## Important files

- `expo-target.config.js`
  - Defines the Apple target metadata, bundle suffix, deployment target, colors, and App Group entitlements.
- `FocusAudioWidget.swift`
  - Widget UI, timeline provider, and AppIntent actions.
- `../../sources/widget/focusAudioWidget.ts`
  - Main-app bridge that syncs focus audio state into the shared App Group store consumed by the widget.

## Shared data flow

1. The main app writes `focus-audio-widget-state` into the App Group store.
2. The widget reads that state from `UserDefaults(suiteName: group.<bundleId>)`.
3. Widget button taps update the same shared payload.
4. When the app becomes active again, `FocusAudioController` merges widget-side changes back into app local settings and re-syncs audio playback.

## Regeneration

After changing target config or adding/removing target files, run:

```sh
cd apps/free/app
npx expo prebuild -p ios --clean
```

## Constraint

Interactive widgets can change shared state immediately, but the actual focus-audio playback engine still lives in the Expo app runtime. That means widget actions can update intent/state right away, while audio playback is finalized when the app process is active.
