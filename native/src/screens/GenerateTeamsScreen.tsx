import React, { useState } from 'react'
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Switch,
  ActivityIndicator,
  StyleSheet,
  SafeAreaView,
  RefreshControl,
} from 'react-native'
import { useNavigation } from '@react-navigation/native'
import { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { MoreStackParamList } from '../navigation/types'
import { useDataStore } from '../stores/dataStore'
import { usePendingStore } from '../stores/pendingStore'
import { isChampion } from '../utils/data.js'
import { apiPost } from '../api.js'
import { colors, fonts, radius } from '../theme'

function ToggleGroup<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { key: T; label: string }[]
  value: T
  onChange: (v: T) => void
}) {
  return (
    <View style={styles.toggleGroup}>
      {options.map(o => (
        <TouchableOpacity
          key={o.key}
          style={[styles.toggleBtn, value === o.key && styles.toggleBtnActive]}
          onPress={() => onChange(o.key)}
          activeOpacity={0.7}
        >
          <Text style={[styles.toggleBtnText, value === o.key && styles.toggleBtnTextActive]}>
            {o.label}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  )
}

export default function GenerateTeamsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<MoreStackParamList>>()
  const { roster, champions, loadAll, loading } = useDataStore()
  const {
    genNumTeams, genTeamSize, genAvgSource, genFillMode, genFillToSize,
    genTeams, genSwapTarget, set,
  } = usePendingStore()

  const [generating, setGenerating] = useState(false)
  const [confirming, setConfirming] = useState(false)

  const availCount = (roster ?? []).slice(1).filter((r: any[]) => r[0] && r[1] === 'Available').length
  const requiredCount = genNumTeams * genTeamSize

  function isFill(player: any) {
    return player.isFill || player.status === 'Fill'
  }

  function isSwapTarget(tIdx: number, pIdx: number) {
    return genSwapTarget?.team === tIdx && genSwapTarget?.idx === pIdx
  }

  function teamTotal(team: any) {
    return Math.round(team.players.reduce((s: number, p: any) => s + p.avg, 0))
  }

  async function doGenerate() {
    setGenerating(true)
    await loadAll()
    try {
      const r = await apiPost('generateTeams', {
        fillMode: genFillMode,
        avgSource: genAvgSource,
        numTeams: genNumTeams,
        teamSize: genTeamSize,
        fillToSize: genFillToSize,
      })
      if (!r || r.error || !Array.isArray(r.teams)) {
        console.error('generateTeams error:', r)
      } else {
        set({ genTeams: r.teams, genSwapTarget: null })
      }
    } catch (e) {
      console.error('generateTeams network error:', e)
    } finally {
      setGenerating(false)
    }
  }

  function handleSwap(tIdx: number, pIdx: number) {
    if (!genSwapTarget) {
      set({ genSwapTarget: { team: tIdx, idx: pIdx } })
    } else if (genSwapTarget.team === tIdx && genSwapTarget.idx === pIdx) {
      set({ genSwapTarget: null })
    } else {
      const teams = JSON.parse(JSON.stringify(genTeams))
      const a = teams[genSwapTarget.team].players[genSwapTarget.idx]
      const b = teams[tIdx].players[pIdx]
      teams[genSwapTarget.team].players[genSwapTarget.idx] = b
      teams[tIdx].players[pIdx] = a
      set({ genTeams: teams, genSwapTarget: null })
    }
  }

  async function useTeams() {
    if (!genTeams) return
    setConfirming(true)
    try {
      await apiPost('confirmMatchups', {
        teams: genTeams.map((t: any) => t.players),
        avgSource: genAvgSource,
      })
      await loadAll()
      set({ genTeams: null, genSwapTarget: null })
      navigation.navigate('MoreHome')
    } catch (e) {
      console.error('confirmMatchups error:', e)
    } finally {
      setConfirming(false)
    }
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={loadAll} tintColor={colors.accent} />}
      >
        <View style={styles.backRow}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} activeOpacity={0.7}>
            <Text style={styles.backBtnText}>←</Text>
          </TouchableOpacity>
          <Text style={styles.screenTitle}>Generate Teams</Text>
        </View>

        {/* Controls */}
        <View style={styles.controlsCard}>
          <View style={styles.controlRow}>
            <Text style={styles.controlLabel}>Number of Teams</Text>
            <ToggleGroup
              options={[2,3,4,5,6].map(n => ({ key: String(n) as any, label: String(n) }))}
              value={String(genNumTeams)}
              onChange={v => set({ genNumTeams: parseInt(v), genTeams: null })}
            />
          </View>

          <View style={styles.controlRow}>
            <Text style={styles.controlLabel}>Players per Team</Text>
            <ToggleGroup
              options={[2,3,4,5].map(n => ({ key: String(n) as any, label: String(n) }))}
              value={String(genTeamSize)}
              onChange={v => set({ genTeamSize: parseInt(v), genTeams: null })}
            />
          </View>

          <View style={styles.controlRow}>
            <Text style={styles.controlLabel}>Avg Source</Text>
            <ToggleGroup
              options={[
                { key: 'last-season', label: 'Last Season' },
                { key: 'current-season', label: 'Current' },
                { key: 'all-time', label: 'All-time' },
              ]}
              value={genAvgSource}
              onChange={v => set({ genAvgSource: v })}
            />
          </View>

          <View style={styles.controlRow}>
            <Text style={styles.controlLabel}>Fill MIA Players With</Text>
            <ToggleGroup
              options={[
                { key: 'League Avg', label: 'League Avg' },
                { key: 'Their Avg', label: 'Their Avg' },
              ]}
              value={genFillMode}
              onChange={v => set({ genFillMode: v })}
            />
          </View>

          <View style={styles.switchRow}>
            <Switch
              value={genFillToSize}
              onValueChange={v => set({ genFillToSize: v })}
              trackColor={{ false: colors.surface3, true: colors.accentDim }}
              thumbColor={genFillToSize ? colors.accent : colors.muted}
            />
            <Text style={styles.switchLabel}>Pad short teams with league avg placeholders</Text>
          </View>

          <View style={styles.availRow}>
            <Text style={styles.availText}>
              Need <Text style={styles.availAccent}>{requiredCount}</Text> players ·{' '}
              <Text style={[styles.availText, { color: availCount >= requiredCount ? colors.success : colors.danger }]}>
                {availCount} available
              </Text>
              {availCount < requiredCount && !genFillToSize ? (
                <Text style={{ color: colors.danger }}> · Short {requiredCount - availCount}</Text>
              ) : null}
            </Text>
          </View>

          <TouchableOpacity
            style={[styles.generateBtn, generating && styles.generateBtnDisabled]}
            onPress={doGenerate}
            disabled={generating}
            activeOpacity={0.7}
          >
            {generating ? (
              <ActivityIndicator size="small" color={colors.bg} style={{ marginRight: 8 }} />
            ) : null}
            <Text style={styles.generateBtnText}>{generating ? 'Generating…' : 'Generate'}</Text>
          </TouchableOpacity>
        </View>

        {/* Generated teams */}
        {genTeams && (
          <>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionLabel}>GENERATED TEAMS</Text>
              <Text style={styles.swapHint}>
                {genSwapTarget ? 'Tap a player to swap' : 'Tap "Swap" to start'}
              </Text>
            </View>

            {genTeams.map((team: any, tIdx: number) => (
              <View key={tIdx} style={styles.teamCard}>
                <View style={styles.teamHead}>
                  <Text style={styles.teamName}>Team {tIdx + 1}</Text>
                  <Text style={styles.teamTotal}>{teamTotal(team)}</Text>
                </View>
                {team.players.map((player: any, pIdx: number) => (
                  <View key={pIdx} style={styles.playerRow}>
                    <View style={{ flex: 1 }}>
                      {isFill(player) ? (
                        <Text style={[styles.playerName, { color: colors.muted, fontStyle: 'italic' }]}>
                          League Avg Fill
                          <Text style={styles.fillTag}> FILL</Text>
                        </Text>
                      ) : (
                        <Text style={styles.playerName}>
                          {player.name}
                          {isChampion(champions, player.name) ? ' 👑' : ''}
                          {player.status === 'Unavailable' ? <Text style={styles.outTag}> OUT</Text> : null}
                        </Text>
                      )}
                    </View>
                    <Text style={styles.playerAvg}>{player.avg.toFixed(1)}</Text>
                    {!isFill(player) && (
                      <TouchableOpacity
                        style={[styles.swapBtn, isSwapTarget(tIdx, pIdx) && styles.swapBtnActive]}
                        onPress={() => handleSwap(tIdx, pIdx)}
                        activeOpacity={0.7}
                      >
                        <Text style={[styles.swapBtnText, isSwapTarget(tIdx, pIdx) && styles.swapBtnTextActive]}>
                          {isSwapTarget(tIdx, pIdx) ? 'Pick swap' : 'Swap'}
                        </Text>
                      </TouchableOpacity>
                    )}
                  </View>
                ))}
              </View>
            ))}

            <TouchableOpacity
              style={[styles.useTeamsBtn, confirming && styles.useTeamsBtnDisabled]}
              onPress={useTeams}
              disabled={confirming}
              activeOpacity={0.7}
            >
              {confirming ? <ActivityIndicator size="small" color={colors.bg} style={{ marginRight: 8 }} /> : null}
              <Text style={styles.useTeamsBtnText}>{confirming ? 'Saving…' : 'Use These Teams'}</Text>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.bg },
  scrollContent: { paddingHorizontal: 16, paddingBottom: 32 },
  backRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
  },
  backBtn: {
    width: 34,
    height: 34,
    borderRadius: radius.cardSm,
    backgroundColor: colors.surface2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backBtnText: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 18,
    color: colors.text,
  },
  screenTitle: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 22,
    color: colors.text,
    fontWeight: '700',
  },
  controlsCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    gap: 14,
    marginBottom: 16,
  },
  controlRow: {
    gap: 8,
  },
  controlLabel: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 11,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: colors.muted,
  },
  toggleGroup: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  toggleBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border2,
  },
  toggleBtnActive: {
    backgroundColor: colors.accentDim,
    borderColor: colors.accent,
  },
  toggleBtnText: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 13,
    color: colors.muted,
    letterSpacing: 0.5,
  },
  toggleBtnTextActive: {
    color: colors.accent,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.surface2,
    borderRadius: radius.cardSm,
    padding: 10,
  },
  switchLabel: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 13,
    color: colors.text,
    flex: 1,
  },
  availRow: { paddingVertical: 2 },
  availText: {
    fontFamily: fonts.barlow,
    fontSize: 12,
    color: colors.muted,
    lineHeight: 18,
  },
  availAccent: { color: colors.accent, fontWeight: '700' },
  generateBtn: {
    backgroundColor: colors.accent,
    borderRadius: radius.cardSm,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  generateBtnDisabled: {
    backgroundColor: colors.surface3,
  },
  generateBtnText: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 15,
    fontWeight: '700',
    color: colors.bg,
    letterSpacing: 0.5,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  sectionLabel: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 11,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: colors.muted,
  },
  swapHint: {
    fontFamily: fonts.barlow,
    fontSize: 12,
    color: colors.muted,
  },
  teamCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.cardMd,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 10,
    overflow: 'hidden',
  },
  teamHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  teamName: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
    letterSpacing: 0.5,
  },
  teamTotal: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 18,
    color: colors.accent,
  },
  playerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: 8,
  },
  playerName: {
    fontFamily: fonts.barlow,
    fontSize: 14,
    color: colors.text,
  },
  outTag: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 10,
    color: colors.danger,
    letterSpacing: 1,
  },
  fillTag: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 10,
    color: colors.muted,
    letterSpacing: 1,
  },
  playerAvg: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 14,
    color: colors.muted,
    minWidth: 36,
    textAlign: 'right',
  },
  swapBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border2,
  },
  swapBtnActive: {
    backgroundColor: colors.accentDim,
    borderColor: colors.accent,
  },
  swapBtnText: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 12,
    color: colors.muted,
    letterSpacing: 0.5,
  },
  swapBtnTextActive: {
    color: colors.accent,
  },
  useTeamsBtn: {
    backgroundColor: colors.accent,
    borderRadius: radius.cardSm,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  useTeamsBtnDisabled: {
    backgroundColor: colors.surface3,
  },
  useTeamsBtnText: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 15,
    fontWeight: '700',
    color: colors.bg,
    letterSpacing: 0.5,
  },
})
