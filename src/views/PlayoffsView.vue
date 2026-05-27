<template>
  <div>
    <!-- Header -->
    <div class="player-detail-header">
      <button class="back-btn" @click="router.push('/more')">←</button>
      <div>
        <div class="player-detail-name">Playoffs</div>
        <div class="subtext">Coming soon</div>
      </div>
    </div>

    <!-- Format cards -->
    <div class="card-md record-card">
      <div class="record-card-head">
        <div class="icon-box lg">🏁</div>
        <div class="player-info">
          <div class="label-sm">Format</div>
          <div class="record-value">Top 4 seeds + snake draft</div>
          <div class="subtext">Seeds → 1, 2, 3, 4, 4, 3, 2, 1 picking remaining players</div>
        </div>
      </div>
    </div>

    <div class="card-md record-card">
      <div class="record-card-head">
        <div class="icon-box lg">🏆</div>
        <div class="player-info">
          <div class="label-sm">Round 1</div>
          <div class="record-value">Top two scoring teams advance</div>
          <div class="subtext">All 4 playoff teams play; cumulative pins decide who moves on</div>
        </div>
      </div>
    </div>

    <div class="card-md record-card">
      <div class="record-card-head">
        <div class="icon-box lg">🥇</div>
        <div class="player-info">
          <div class="label-sm">Finals</div>
          <div class="record-value">Top 2 head-to-head for championship; bottom 2 for 3rd</div>
          <div class="subtext">Higher pin total wins each game</div>
        </div>
      </div>
    </div>

    <!-- Coming-soon note -->
    <p style="color:var(--muted);font-size:13px;line-height:1.5;margin-top:16px;text-align:center;">
      The playoff hub will let you set seeds, run the snake draft on this screen, and score the
      playoff week.<br><br>
      For now, run playoffs manually using Match History (scores record to the same Weekly Scores
      sheet).
    </p>
  </div>
</template>

<script setup>
import { useRouter } from 'vue-router'

const router = useRouter()
</script>
