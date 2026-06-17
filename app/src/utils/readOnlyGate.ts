// Module-level mirror of authStore.isReadOnly, read by the Supabase client's
// guarded fetch (client.ts). Kept here — not in authStore — so the client can
// consult it without importing the store (which imports the client back).
let readOnly = false

export const setReadOnly = (value: boolean) => {
  readOnly = value
}

export const isReadOnlyNow = () => readOnly
