import React, { useState } from 'react'
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { colors, fonts, radius } from '../theme'
import { supabase } from '../utils/supabase/client'
import { players } from '../utils/supabase/db'
import Button from '../components/Button'

type Step = 'phone' | 'otp'

function formatPhone(digits: string): string {
  return `+1${digits}`
}

export default function LoginScreen() {
  const [step, setStep] = useState<Step>('phone')
  const [phone, setPhone] = useState('')
  const [otp, setOtp] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSendCode() {
    const digits = phone.replace(/\D/g, '')
    if (digits.length !== 10) {
      setError('Enter a valid 10-digit US phone number.')
      return
    }
    setLoading(true)
    setError('')
    const { data: isRegistered } = await players.isRegistered(formatPhone(digits))
    if (!isRegistered) {
      setLoading(false)
      setError('This number isn\'t registered with the league.')
      return
    }
    const { error: otpErr } = await supabase.auth.signInWithOtp({ phone: formatPhone(digits) })
    setLoading(false)
    if (otpErr) {
      setError(otpErr.message)
    } else {
      setStep('otp')
    }
  }

  async function handleVerify() {
    const digits = phone.replace(/\D/g, '')
    if (otp.length !== 6) {
      setError('Enter the 6-digit code.')
      return
    }
    setLoading(true)
    setError('')
    const { error: verifyErr } = await supabase.auth.verifyOtp({
      phone: formatPhone(digits),
      token: otp,
      type: 'sms',
    })
    setLoading(false)
    if (verifyErr) {
      setError(verifyErr.message)
    }
    // On success the auth state change listener in authStore handles the transition.
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

            {step === 'phone' ? (
              <>
                <Text style={styles.label}>Phone Number</Text>
                <View style={styles.phoneRow}>
                  <View style={styles.prefix}>
                    <Text style={styles.prefixText}>+1</Text>
                  </View>
                  <TextInput
                    style={styles.phoneInput}
                    placeholder="(555) 555-5555"
                    placeholderTextColor={colors.muted}
                    keyboardType="phone-pad"
                    value={phone}
                    onChangeText={text => {
                      setPhone(text)
                      if (error) setError('')
                    }}
                    onSubmitEditing={handleSendCode}
                    returnKeyType="send"
                    autoComplete="tel"
                    maxLength={14}
                  />
                </View>

                {!!error && <Text style={styles.error}>{error}</Text>}

                <Button label="SEND CODE" size="lg" onPress={handleSendCode} loading={loading} disabled={loading} style={styles.button} />
              </>
            ) : (
              <>
                <Text style={styles.label}>
                  Enter the 6-digit code sent to{'\n'}+1 {phone.replace(/\D/g, '')}
                </Text>
                <TextInput
                  style={[styles.input, styles.otpInput]}
                  placeholder="000000"
                  placeholderTextColor={colors.muted}
                  keyboardType="number-pad"
                  value={otp}
                  onChangeText={text => {
                    setOtp(text.replace(/\D/g, '').slice(0, 6))
                    if (error) setError('')
                  }}
                  onSubmitEditing={handleVerify}
                  returnKeyType="done"
                  maxLength={6}
                  autoFocus
                />

                {!!error && <Text style={styles.error}>{error}</Text>}

                <Button label="VERIFY" size="lg" onPress={handleVerify} loading={loading} disabled={loading || otp.length < 6} style={styles.button} />

                <TouchableOpacity
                  style={styles.back}
                  onPress={() => {
                    setStep('phone')
                    setOtp('')
                    setError('')
                  }}
                  activeOpacity={0.7}
                >
                  <Text style={styles.backText}>← Change number</Text>
                </TouchableOpacity>
              </>
            )}
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
    marginBottom: 28,
  },
  label: {
    fontFamily: fonts.barlow,
    fontSize: 13,
    color: colors.muted,
    alignSelf: 'flex-start',
    marginBottom: 8,
    textAlign: 'left',
    lineHeight: 18,
  },
  phoneRow: {
    width: '100%',
    flexDirection: 'row',
    marginBottom: 10,
    gap: 8,
  },
  prefix: {
    backgroundColor: colors.surface2,
    borderRadius: radius.cardSm,
    borderWidth: 1,
    borderColor: colors.border2,
    paddingHorizontal: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  prefixText: {
    color: colors.muted,
    fontFamily: fonts.barlow,
    fontSize: 16,
  },
  phoneInput: {
    flex: 1,
    backgroundColor: colors.surface2,
    borderRadius: radius.cardSm,
    borderWidth: 1,
    borderColor: colors.border2,
    paddingHorizontal: 16,
    paddingVertical: 14,
    color: colors.text,
    fontFamily: fonts.barlow,
    fontSize: 16,
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
  otpInput: {
    letterSpacing: 8,
    textAlign: 'center',
    fontSize: 24,
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
    marginTop: 4,
  },
  back: {
    marginTop: 16,
  },
  backText: {
    fontFamily: fonts.barlow,
    fontSize: 13,
    color: colors.muted,
  },
})
