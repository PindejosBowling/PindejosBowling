import { create } from 'zustand'
import { players, avatars } from '../utils/supabase/db'

// Centralized signed-URL cache for player avatars.
// Many list screens key on player name (not id), so we expose lookups by both.
// Signed URLs are short-lived; call load() on app hydrate and after admin changes.
interface AvatarStore {
  byId: Record<string, string>
  byName: Record<string, string>
  loaded: boolean
  load: () => Promise<void>
}

export const useAvatarStore = create<AvatarStore>((set) => ({
  byId: {},
  byName: {},
  loaded: false,

  load: async () => {
    const { data, error } = await players.list()
    if (error || !data) return

    const withPhoto = data.filter((p) => p.avatar_path)
    if (withPhoto.length === 0) {
      set({ byId: {}, byName: {}, loaded: true })
      return
    }

    const paths = withPhoto.map((p) => p.avatar_path as string)
    const { data: signed } = await avatars.signedUrls(paths)

    const byId: Record<string, string> = {}
    const byName: Record<string, string> = {}
    withPhoto.forEach((p, i) => {
      const url = signed?.[i]?.signedUrl
      if (!url) return
      byId[p.id] = url
      if (p.name) byName[p.name.toLowerCase()] = url
    })

    set({ byId, byName, loaded: true })
  },
}))
