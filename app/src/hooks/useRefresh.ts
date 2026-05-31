import { useState } from 'react'

export function useRefresh(fn: () => Promise<void>) {
  const [refreshing, setRefreshing] = useState(false)
  async function onRefresh() {
    setRefreshing(true)
    await fn()
    setRefreshing(false)
  }
  return { refreshing, onRefresh }
}
