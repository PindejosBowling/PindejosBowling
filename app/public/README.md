# public/

Static files in this directory are copied into `dist/` during the GitHub Pages build (see `.github/workflows/deploy.yml`) and served at the root of the site alongside the Expo web bundle.

## consent.html

**Purpose:** Proof-of-consent page required to complete Twilio toll-free number verification.

Twilio's toll-free verification process requires a publicly accessible URL that demonstrates end-user opt-in consent for SMS messaging. This page documents that Pindejos Bowling League members have agreed to receive OTP text messages as part of their league registration.

**Live URL:** `https://jordanreticker.github.io/PindejosBowling/consent.html`

This URL is submitted as the "Message Flow / Opt-in URL" field in the Twilio toll-free verification form. Do not remove or rename this file — doing so would break the verification record.
