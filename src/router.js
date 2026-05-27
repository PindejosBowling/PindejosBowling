import { createRouter, createWebHashHistory } from 'vue-router'

import MatchupsView  from './views/MatchupsView.vue'
import RsvpView      from './views/RsvpView.vue'
import StandingsView from './views/StandingsView.vue'
import HistoryView   from './views/HistoryView.vue'
import MoreView      from './views/MoreView.vue'
import MoreHomeView  from './views/MoreHomeView.vue'

import PlayerListView    from './views/PlayerListView.vue'
import PlayerDetailView  from './views/PlayerDetailView.vue'
import LeagueRecordsView from './views/LeagueRecordsView.vue'
import HeadToHeadView    from './views/HeadToHeadView.vue'
import ChemistryView     from './views/ChemistryView.vue'
import SeasonHistoryView from './views/SeasonHistoryView.vue'
import TrashBoardView    from './views/TrashBoardView.vue'
import GenerateTeamsView from './views/GenerateTeamsView.vue'
import PlayoffsView      from './views/PlayoffsView.vue'

const routes = [
  { path: '/',          name: 'matchups',  component: MatchupsView  },
  { path: '/rsvp',      name: 'rsvp',      component: RsvpView      },
  { path: '/standings', name: 'standings', component: StandingsView },
  { path: '/history',   name: 'history',   component: HistoryView   },
  {
    path: '/more',
    component: MoreView,
    children: [
      { path: '',               name: 'more-home',      component: MoreHomeView  },
      { path: 'players',        name: 'player-list',    component: PlayerListView    },
      { path: 'players/:name',  name: 'player-detail',  component: PlayerDetailView  },
      { path: 'records',        name: 'records',        component: LeagueRecordsView },
      { path: 'h2h',            name: 'h2h',            component: HeadToHeadView    },
      { path: 'chemistry',      name: 'chemistry',      component: ChemistryView     },
      { path: 'season-history', name: 'season-history', component: SeasonHistoryView },
      { path: 'board',          name: 'board',          component: TrashBoardView    },
      { path: 'generate',       name: 'generate',       component: GenerateTeamsView },
      { path: 'playoffs',       name: 'playoffs',       component: PlayoffsView      },
    ],
  },
  { path: '/:pathMatch(.*)*', redirect: '/' },
]

export default createRouter({
  history: createWebHashHistory(),
  routes,
})
