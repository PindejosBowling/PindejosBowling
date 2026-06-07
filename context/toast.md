# Toast system

The global toast (`app/src/components/Toast.tsx` + the `toasts` array / `showToast` action in `app/src/stores/uiStore.ts`).

## How it works

- `showToast(msg, type?)` pushes a `{ id, msg, type }` onto the global `useUiStore.toasts` array and auto-removes it after a length-scaled timeout. Toast `id`s are monotonic (`Date.now()`-based).
- `<Toast />` reads that **global** array. Every mounted instance renders the same latest toast.
- It is mounted **per-screen and per-modal** (~16 call sites), **not** once at the root.

## Why per-screen, not a single root Toast

React Native `Modal` renders in its own native overlay **above** the navigator tree, so a root-level `<Toast />` would appear *beneath* any open modal. The Accept / Counter / Admin modals each mount their own `<Toast />` for exactly this reason.

**Do not "consolidate" to a single root Toast — it breaks toasts shown from inside modals.**

## Mount-baseline guard (duplicate-toast fix)

Because the array is global and many `<Toast />` instances are mounted, two simultaneously-visible instances would render the *same* toast. This is normally hidden (stacked screens / modal overlays cover the one behind), but a horizontal slide transition mounts both the outgoing and incoming screen at once — so both show the toast side-by-side.

The original symptom: `PvPCreateScreen.submit()` calls `showToast('Challenge sent')` then `navigation.replace('PvPChallengeDetail', …)`. During the slide, both screens' `<Toast />` rendered "Challenge Sent" → **two green badges**.

Fix (in `Toast.tsx`): each instance records the latest toast `id` present **when it mounts** (its baseline) and only renders toasts with a greater id. A screen sliding in therefore never inherits a toast its predecessor triggered mid-transition — each toast belongs to the screen mounted when it fired. Modal toasts are unaffected (a modal mounts before its own actions fire, so newer ids still show).

**If you see duplicate toasts during a navigation transition, check this mount-baseline logic — not the individual `showToast` call sites.**
