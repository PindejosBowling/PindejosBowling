import { useState, useCallback, useEffect, useRef, DependencyList } from 'react'

interface AsyncData<T> {
  loading: boolean
  data: T | null
  error: unknown
  reload: () => Promise<void>
  // Local write into `data` without a refetch — for appending a pagination page,
  // optimistic edits, etc. The next load/reload overwrites it with server truth.
  mutate: (updater: (prev: T | null) => T | null) => void
}

// The shared load lifecycle behind the use*Data hooks: loads on mount and
// whenever `deps` change, exposes `reload` for pull-to-refresh / focus effects.
//
// Soft-load gate: `loading` is true only until the FIRST load settles. Later
// loads (deps changes, reload) run silently over the existing data, so
// pull-to-refresh and season switches never flash the full-screen spinner.
// Complements useRefresh, which owns only the pull-spinner state.
//
// On error the previous `data` is kept (stale beats blank), the error is
// logged under `label`, and `error` is set for hooks that want a UI state.
export function useAsyncData<T>(
  fetcher: () => Promise<T>,
  deps: DependencyList,
  label = 'useAsyncData',
): AsyncData<T> {
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<unknown>(null)
  const loadedOnce = useRef(false)

  const load = useCallback(async () => {
    if (!loadedOnce.current) setLoading(true)
    try {
      setData(await fetcher())
      setError(null)
    } catch (e) {
      console.error(`${label} error:`, e)
      setError(e)
    } finally {
      loadedOnce.current = true
      setLoading(false)
    }
    // The fetcher is intentionally keyed by the caller's deps, not its identity —
    // callers pass inline closures that would otherwise change every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  useEffect(() => { load() }, [load])

  return { loading, data, error, reload: load, mutate: setData }
}
