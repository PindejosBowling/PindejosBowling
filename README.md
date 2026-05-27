# PindejosBowling
Bowling hub for the Pindejos Bowling League

## Local Development

### Vue web app
`npm run dev` will start the server, accessible at http://localhost:5173/PindejosBowling/

### React Native app (iOS)
The React Native app lives in `native/` and runs independently alongside the Vue app.

```bash
cd native
npx expo start
```

Then press `i` to open in the iOS Simulator (requires Xcode to be installed).

**Phase 1 verification checklist:**
- [ ] App launches without errors in the simulator
- [ ] All 5 bottom tabs are visible and tappable: This Week, RSVP, Standings, Matches, More
- [ ] Tapping "More" shows the More Home placeholder screen
- [ ] From More Home, tapping back (swipe or back gesture) returns to the tab correctly
- [ ] No red error screens on launch