import { useState } from 'react'
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native'
import { useUiStore } from '../stores/uiStore'
import { weeks, scores, betLines, placedBets, pinLedger } from '../utils/supabase/db'
import type { TablesInsert } from '../utils/supabase/database.types'
import { colors, fonts, radius } from '../theme'
import Toast from './Toast'

interface Props {
  visible: boolean
  onClose: () => void
}

async function settleBettingForWeek(activeWeek: { id: string; season_id: string; week_number: number }) {
  const [scoresRes, linesRes] = await Promise.all([
    scores.listByWeekWithGames(activeWeek.id),
    betLines.listOpenByWeek(activeWeek.id),
  ])

  const weekScores = (scoresRes.data ?? []) as any[]
  const openLines = (linesRes.data ?? []) as any[]

  // Build lookup: `${player_id}|${game_number}` → actual score
  const scoreMap: Record<string, number> = {}
  for (const s of weekScores) {
    const pid = (s.team_slots as any)?.player_id
    const gameNum = (s.games as any)?.game_number
    if (pid && gameNum != null && s.score != null) {
      scoreMap[`${pid}|${gameNum}`] = s.score
    }
  }

  const ledgerEntries: TablesInsert<'pin_ledger'>[] = []

  // Score credits: +score per game per player
  for (const s of weekScores) {
    const pid = (s.team_slots as any)?.player_id
    const gameNum = (s.games as any)?.game_number
    if (!pid || s.score == null) continue
    ledgerEntries.push({
      player_id: pid,
      season_id: activeWeek.season_id,
      amount: s.score,
      type: 'score_credit',
      description: `Week ${activeWeek.week_number} Game ${gameNum}: ${s.score} pins`,
    })
  }

  // Settle open bet lines
  const lineUpdates: Promise<any>[] = []
  const betUpdates: Promise<any>[] = []

  for (const line of openLines) {
    const actualScore = scoreMap[`${line.player_id}|${line.game_number}`]
    if (actualScore == null) {
      // No score recorded — close line without result
      lineUpdates.push(Promise.resolve(betLines.update(line.id, { is_open: false })))
      continue
    }

    const result: 'over' | 'under' | 'push' =
      actualScore > Number(line.line) ? 'over' :
      actualScore < Number(line.line) ? 'under' : 'push'

    lineUpdates.push(Promise.resolve(betLines.update(line.id, { result, actual_score: actualScore, is_open: false })))

    // Settle placed bets on this line
    const { data: bets } = await placedBets.listByLine(line.id)
    const playerName = (line as any).players?.name ?? 'Player'
    for (const bet of (bets ?? []) as any[]) {
      const won = bet.pick === result
      const isPush = result === 'push'
      const payout = won && !isPush ? bet.wager : 0 // net winnings; push/loss = 0

      betUpdates.push(Promise.resolve(placedBets.update(bet.id, { payout, settled_at: new Date().toISOString() })))

      if (isPush) {
        ledgerEntries.push({
          player_id: bet.player_id,
          season_id: activeWeek.season_id,
          amount: bet.wager,
          type: 'bet_push',
          description: `Push: ${playerName} at ${line.line} — Game ${line.game_number}`,
          placed_bet_id: bet.id,
        })
      } else if (won) {
        ledgerEntries.push({
          player_id: bet.player_id,
          season_id: activeWeek.season_id,
          amount: bet.wager * 2,
          type: 'bet_won',
          description: `Won: ${playerName} ${result} ${line.line} — Week ${activeWeek.week_number} Game ${line.game_number}`,
          placed_bet_id: bet.id,
        })
      }
    }
  }

  await Promise.all([...lineUpdates, ...betUpdates])
  if (ledgerEntries.length > 0) {
    await pinLedger.insert(ledgerEntries)
  }
}

export default function AdminArchiveModal({ visible, onClose }: Props) {
  const [saving, setSaving] = useState(false)
  const { showToast } = useUiStore()

  async function confirm() {
    setSaving(true)
    try {
      const { data: activeWeek, error: weekErr } = await weeks.getActive()
      if (weekErr || !activeWeek) {
        showToast('No active week found', 'error')
        setSaving(false)
        return
      }

      const today = new Date().toISOString().slice(0, 10)
      const { error: archiveErr } = await weeks.update(activeWeek.id, { is_archived: true, bowled_at: today })
      if (archiveErr) {
        showToast('Failed to archive week', 'error')
        setSaving(false)
        return
      }

      // Credit pin balances and settle bets for the archived week.
      await settleBettingForWeek(activeWeek)

      const { error: insertErr } = await weeks.insert({
        season_id: activeWeek.season_id,
        week_number: activeWeek.week_number + 1,
      })
      if (insertErr) {
        showToast(`Week ${activeWeek.week_number} archived — failed to create next week`, 'error')
      } else {
        showToast(`Week ${activeWeek.week_number} archived`, 'success')
      }

      onClose()
    } catch {
      showToast('Archive failed', 'error')
      setSaving(false)
    }
  }

  function handleClose() {
    if (saving) return
    onClose()
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleClose}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={handleClose}>
        <TouchableOpacity style={styles.sheet} activeOpacity={1} onPress={() => {}}>
          <Text style={styles.title}>Archive &amp; Advance Week?</Text>
          <Text style={styles.subtitle}>
            Locks this week's scores into the standings and creates a new week for team generation.
          </Text>
          <View style={styles.btnRow}>
            <TouchableOpacity
              style={styles.btnCancel}
              onPress={handleClose}
              disabled={saving}
              activeOpacity={0.7}
            >
              <Text style={styles.btnCancelText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.btnPrimary, saving && styles.btnDisabled]}
              onPress={confirm}
              disabled={saving}
              activeOpacity={0.7}
            >
              {saving ? (
                <ActivityIndicator size="small" color={colors.bg} />
              ) : (
                <Text style={styles.btnPrimaryText}>Archive &amp; Advance</Text>
              )}
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
      {/* Rendered inside the Modal so toasts aren't occluded by the native modal layer. */}
      <Toast />
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  sheet: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    padding: 24,
    borderWidth: 1,
    borderColor: colors.border,
  },
  title: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 22,
    color: colors.text,
    fontWeight: '700',
    marginBottom: 8,
  },
  subtitle: {
    fontFamily: fonts.barlow,
    fontSize: 13,
    color: colors.muted,
    lineHeight: 20,
    marginBottom: 20,
  },
  btnRow: {
    flexDirection: 'row',
    gap: 10,
  },
  btnCancel: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: radius.cardSm,
    borderWidth: 1,
    borderColor: colors.border2,
    alignItems: 'center',
  },
  btnCancelText: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 15,
    color: colors.muted,
    letterSpacing: 0.5,
  },
  btnPrimary: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: radius.cardSm,
    backgroundColor: colors.accent,
    alignItems: 'center',
  },
  btnPrimaryText: {
    fontFamily: fonts.barlowCondensed,
    fontSize: 15,
    color: colors.bg,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  btnDisabled: {
    opacity: 0.4,
  },
})
