import { createRouter, createWebHashHistory } from 'vue-router'

import MatchupsView  from './views/MatchupsView.vue'
import RsvpView      from './views/RsvpView.vue'
import StandingsView from './views/StandingsView.vue'
import HistoryView   from './views/HistoryView.vue'
import MoreView      from './views/MoreView.vue'
import MoreHomeView  from './views/MoreHomeView.vue'

import PlayerList    from './components/PlayerList.vue'
import PlayerDetail  from './components/PlayerDetail.vue'
import LeagueRecords from './components/LeagueRecords.vue'
import HeadToHead    from './components/HeadToHead.vue'
import Chemistry     from './components/Chemistry.vue'
import SeasonHistory from './components/SeasonHistory.vue'
import TrashBoard    from './components/TrashBoard.vue'
import GenerateTeams from './components/GenerateTeams.vue'
import Playoffs      from './components/Playoffs.vue'

const routes = [
  { path: '/',          component: MatchupsView },
  { path: '/rsvp',      component: RsvpView },
  { path: '/standings', component: StandingsView },
  { path: '/history',   component: HistoryView },
  {
    path: '/more',
    component: MoreView,
    children: [
      { path: '',               name: 'more-home',      component: MoreHomeView  },
      { path: 'players',        name: 'player-list',    component: PlayerList    },
      { path: 'players/:name',  name: 'player-detail',  component: PlayerDetail  },
      { path: 'records',        name: 'records',        component: LeagueRecords },
      { path: 'h2h',            name: 'h2h',            component: HeadToHead    },
      { path: 'chemistry',      name: 'chemistry',      component: Chemistry     },
      { path: 'season-history', name: 'season-history', component: SeasonHistory },
      { path: 'board',          name: 'board',          component: TrashBoard    },
      { path: 'generate',       name: 'generate',       component: GenerateTeams },
      { path: 'playoffs',       name: 'playoffs',       component: Playoffs      },
    ],
  },
  { path: '/:pathMatch(.*)*', redirect: '/' },
]

export default createRouter({
  history: createWebHashHistory(),
  routes,
})
