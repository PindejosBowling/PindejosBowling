import React from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { spreadAndML } from '../utils/helpers'
import { colors, fonts, radius } from '../theme'

interface TeamForOdds {
  name: string
  players: { name: string; isFill?: boolean; effectiveAvg?: number }[]
}

interface OddsBlockProps {
  teamA: TeamForOdds
  teamB: TeamForOdds
  leagueAvg: number
  label: string
}

export default function OddsBlock({ teamA, teamB, leagueAvg, label }: OddsBlockProps) {
  const expectedA = teamA.players.reduce((s, p) => {
    const avg = p.effectiveAvg ?? leagueAvg
    return s + (avg > 0 ? Math.round(avg) : 0)
  }, 0)

  const expectedB = teamB.players.reduce((s, p) => {
    const avg = p.effectiveAvg ?? leagueAvg
    return s + (avg > 0 ? Math.round(avg) : 0)
  }, 0)

  const odds = spreadAndML(expectedA, expectedB)
  const teamAIsFav = odds.fav === 't1'

  const favName = odds.fav === 't1' ? teamA.name : odds.fav === 't2' ? teamB.name : ''
  const dogName = odds.fav === 't1' ? teamB.name : odds.fav === 't2' ? teamA.name : ''

  const teamARoster = teamA.players.map(p => (p.isFill ? 'Fill' : p.name)).join(' · ') || '—'
  const teamBRoster = teamB.players.map(p => (p.isFill ? 'Fill' : p.name)).join(' · ') || '—'

  return (
    <View style={styles.block}>
      {odds.fav === 'tie' ? (
        <>
          <View style={styles.head}>
            <Text style={styles.label}>{label}</Text>
            <Text style={styles.pickem}>PICK 'EM ({expectedA})</Text>
          </View>
          <View style={styles.teams}>
            <View style={styles.teamSide}>
              <Text style={styles.teamName}>{teamA.name}<Text style={styles.proj}> {expectedA}</Text></Text>
              <Text style={styles.roster}>{teamARoster}</Text>
            </View>
            <View style={styles.teamSide}>
              <Text style={styles.teamName}>{teamB.name}<Text style={styles.proj}> {expectedB}</Text></Text>
              <Text style={styles.roster}>{teamBRoster}</Text>
            </View>
          </View>
        </>
      ) : (
        <>
          <View style={styles.head}>
            <Text style={styles.label}>{label}</Text>
            <View style={styles.lineStack}>
              <View style={styles.lineRow}>
                <Text style={styles.prefix}>SPREAD</Text>
                <View style={styles.chipFav}><Text style={styles.chipFavText}>{favName} -{odds.spread}</Text></View>
              </View>
              <View style={styles.lineRow}>
                <Text style={styles.prefix}>ML</Text>
                <View style={styles.chipFav}><Text style={styles.chipFavText}>{favName} {odds.ml?.fav}</Text></View>
                <View style={styles.chipDog}><Text style={styles.chipDogText}>{dogName} {odds.ml?.dog}</Text></View>
              </View>
            </View>
          </View>
          <View style={styles.teams}>
            <View style={[styles.teamSide, teamAIsFav && styles.teamFav]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={styles.teamName}>{teamA.name}</Text>
                {teamAIsFav && <View style={styles.favTag}><Text style={styles.favTagText}>FAV</Text></View>}
                <Text style={styles.proj}>{expectedA}</Text>
              </View>
              <Text style={styles.roster}>{teamARoster}</Text>
            </View>
            <View style={[styles.teamSide, !teamAIsFav && styles.teamFav]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={styles.teamName}>{teamB.name}</Text>
                {!teamAIsFav && <View style={styles.favTag}><Text style={styles.favTagText}>FAV</Text></View>}
                <Text style={styles.proj}>{expectedB}</Text>
              </View>
              <Text style={styles.roster}>{teamBRoster}</Text>
            </View>
          </View>
        </>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  block: {
    marginBottom: 12,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  head: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  label: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 11,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: colors.muted,
    flex: 1,
    marginRight: 8,
  },
  pickem: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 13,
    fontWeight: '700',
    color: colors.accent,
    letterSpacing: 1,
  },
  lineStack: { alignItems: 'flex-end', gap: 4 },
  lineRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  prefix: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 10,
    letterSpacing: 1,
    color: colors.muted,
  },
  chipFav: {
    backgroundColor: colors.accentDim,
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  chipFavText: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 12,
    color: colors.accent,
    letterSpacing: 0.5,
  },
  chipDog: {
    backgroundColor: colors.surface3,
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  chipDogText: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 12,
    color: colors.muted,
    letterSpacing: 0.5,
  },
  teams: { flexDirection: 'row', gap: 8 },
  teamSide: { flex: 1 },
  teamFav: {},
  teamName: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 13,
    color: colors.text,
    fontWeight: '700',
  },
  proj: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 13,
    color: colors.muted,
  },
  roster: {
    fontFamily: fonts.barlow,
    fontSize: 11,
    color: colors.muted,
    marginTop: 2,
  },
  favTag: {
    backgroundColor: colors.accentDim,
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  favTagText: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 10,
    color: colors.accent,
    letterSpacing: 1,
  },
})
