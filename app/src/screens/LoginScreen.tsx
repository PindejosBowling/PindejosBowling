import React, { useState } from 'react'
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { colors, fonts, radius } from '../theme'
import * as Crypto from 'expo-crypto'
import { credentials } from '../utils/supabase/db'
import { useAuthStore, type UserRole } from '../stores/authStore'

export default function LoginScreen() {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const setRole = useAuthStore(s => s.setRole)

  async function handleLogin() {
    if (!password.trim()) return
    setLoading(true)
    setError('')
    try {
      const hash = await Crypto.digestStringAsync(
        Crypto.CryptoDigestAlgorithm.SHA256,
        password.trim(),
      )
      const { data, error: dbErr } = await credentials.getByHash(hash)
      if (dbErr || !data) {
        setError('Incorrect password.')
      } else {
        await setRole(data.role as UserRole)
      }
    } catch {
      setError('Something went wrong. Try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.center}>
          <View style={styles.card}>
            <Text style={styles.logo}>🎳</Text>
            <Text style={styles.title}>PINDEJOS</Text>
            <Text style={styles.subtitle}>BOWLING LEAGUE</Text>

            <TextInput
              style={styles.input}
              placeholder="Enter password"
              placeholderTextColor={colors.muted}
              secureTextEntry={false}
              value={password}
              onChangeText={text => {
                setPassword(text)
                if (error) setError('')
              }}
              onSubmitEditing={handleLogin}
              returnKeyType="go"
              autoCapitalize="none"
              autoCorrect={false}
            />

            {!!error && <Text style={styles.error}>{error}</Text>}

            <TouchableOpacity
              style={[styles.button, loading && styles.buttonDisabled]}
              onPress={handleLogin}
              disabled={loading}
              activeOpacity={0.8}
            >
              {loading ? (
                <ActivityIndicator color={colors.bg} />
              ) : (
                <Text style={styles.buttonText}>ENTER</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  flex: {
    flex: 1,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  card: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    padding: 32,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border2,
  },
  logo: {
    fontSize: 52,
    marginBottom: 8,
  },
  title: {
    fontFamily: fonts.barlowCondensedHeavy,
    fontSize: 38,
    color: colors.accent,
    letterSpacing: 5,
  },
  subtitle: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 13,
    color: colors.muted,
    letterSpacing: 3,
    marginBottom: 32,
  },
  input: {
    width: '100%',
    backgroundColor: colors.surface2,
    borderRadius: radius.cardSm,
    borderWidth: 1,
    borderColor: colors.border2,
    paddingHorizontal: 16,
    paddingVertical: 14,
    color: colors.text,
    fontFamily: fonts.barlow,
    fontSize: 16,
    marginBottom: 10,
  },
  error: {
    color: colors.danger,
    fontFamily: fonts.barlow,
    fontSize: 13,
    marginBottom: 10,
    textAlign: 'center',
  },
  button: {
    width: '100%',
    backgroundColor: colors.accent,
    borderRadius: radius.cardSm,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 4,
  },
  buttonDisabled: {
    opacity: 0.55,
  },
  buttonText: {
    fontFamily: fonts.barlowCondensedHeavy,
    fontSize: 18,
    color: colors.bg,
    letterSpacing: 3,
  },
})
