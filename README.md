# PindejosBowling
Bowling hub for the Pindejos Bowling League

## Local Development

One-time installation of `brew` (MacOS Package Manager) if needed:
```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

One-time installation of `node` if needed:
```bash
brew install node
```

The app lives in `app/`. 

Install dependencies (one-time, after cloning):
```bash
cd app
npm install
```

### iOS simulator
```bash
cd app
npx expo start --ios
```

### Web (localhost)
```bash
cd app
npx expo start --web
```
Opens at http://localhost:8081

## Supabase Database

Schema is version-controlled in `supabase/migrations/`. The CLI was installed via Homebrew (`supabase/tap/supabase`).

### Apply migrations to the remote database

```bash
supabase link --project-ref lyihsvxraurjghjqxaau
supabase db push
```

`supabase link` will prompt for the database password (Project Settings → Database in the Supabase dashboard).

### Add a new migration

```bash
supabase migration new <migration_name>
# Edit the generated file in supabase/migrations/
supabase db push
```

---

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

### Environment variables

Environment variables are stored as EAS project secrets — never in the repo. To add or update a variable:

```bash
cd app

# Public vars (embedded in JS bundle, visible to end-users)
eas env:create --scope project --name EXPO_PUBLIC_SUPABASE_URL \
  --value "<value>" --visibility plaintext --environment preview

# Sensitive vars (encrypted, redacted in build logs)
eas env:create --scope project --name EXPO_PUBLIC_SUPABASE_API_KEY \
  --value "<value>" --visibility sensitive --environment preview
```

Repeat with `--environment production` for production builds. View and manage existing vars at [expo.dev](https://expo.dev) → Projects → pindejos-bowling → Environment Variables.

**Current variables required:**
| Variable | Visibility | Environments |
|---|---|---|
| `EXPO_PUBLIC_SUPABASE_URL` | plaintext | preview, production |
| `EXPO_PUBLIC_SUPABASE_API_KEY` | sensitive | preview, production |

### EAS project info

- EAS project ID: `7ecaf340-1c50-4e12-8333-6e266d154574`
- Bundle ID: `com.gsblinkhorn.pindejosbowling`
- Build history: [expo.dev](https://expo.dev) → Projects → pindejos-bowling