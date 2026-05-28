# PindejosBowling
Bowling hub for the Pindejos Bowling League

## Local Development

### Vue web app
`npm run dev` will start the server, accessible at http://localhost:5173/PindejosBowling/

### React Native app (iOS)
The React Native app lives in `app/` and runs independently alongside the Vue app.

```bash
cd app
npx expo start --ios
```

Then press `i` to open in the iOS Simulator (requires Xcode to be installed).

**Phase 1 verification checklist:**
- [ ] App launches without errors in the simulator
- [ ] All 5 bottom tabs are visible and tappable: This Week, RSVP, Standings, Matches, More
- [ ] Tapping "More" shows the More Home placeholder screen
- [ ] From More Home, tapping back (swipe or back gesture) returns to the tab correctly
- [ ] No red error screens on launch

## Deploying to TestFlight / Testers

This app uses [EAS (Expo Application Services)](https://expo.dev) for building and distribution. Builds are compiled remotely — no Xcode required.

### Adding a new tester (preview builds)

Preview builds are distributed ad-hoc (no App Store queue) but require each tester's device to be registered first.

1. Run the device registration command:
   ```bash
   cd app
   eas device:create
   ```
2. Share the generated URL or QR code with the tester — they open it on their iPhone and install the registration profile.
3. After their device is registered, build and share the preview:
   ```bash
   eas build --platform ios --profile preview
   ```
   EAS will output an install link / QR code the tester can open on their phone.

### Releasing a TestFlight build

TestFlight builds don't require device registration but go through Apple's processing queue (~15-30 min).

1. Build and submit in one step:
   ```bash
   eas build --platform ios --profile production --auto-submit
   ```
2. Once processed, go to [App Store Connect](https://appstoreconnect.apple.com) → your app → **TestFlight** and add the tester under Internal Testing.
3. The tester installs the **TestFlight** app from the App Store, accepts the email invite, and installs the build.

### EAS project info

- EAS project ID: `7ecaf340-1c50-4e12-8333-6e266d154574`
- Bundle ID: `com.gsblinkhorn.pindejosbowling`
- Build history: [expo.dev](https://expo.dev) → Projects → pindejos-bowling