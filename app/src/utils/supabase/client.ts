import AsyncStorage from '@react-native-async-storage/async-storage'
import { createClient } from '@supabase/supabase-js'
import type { Database } from './database.types'

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.EXPO_PUBLIC_SUPABASE_API_KEY

console.log('[supabase] EXPO_PUBLIC_SUPABASE_URL:', supabaseUrl ?? '(undefined)')
console.log('[supabase] EXPO_PUBLIC_SUPABASE_API_KEY:', supabaseKey ? '(set)' : '(undefined)')

export const supabase = createClient<Database>(supabaseUrl, supabaseKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
})
