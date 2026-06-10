// parseLanetalk.ts — TypeScript port of app/src/scripts/parse_lanetalk.py.
//
// Extracts frame-level bowling data from a Lanetalk "shared session" HTML page
// (http://shared.lanetalk.com/<hash>) into the same structured shape the Python
// script emits. Kept deliberately close to the Python (same regexes, same field
// names) so the .py remains a readable reference spec. Standard-library only.
//
// The Python is the source of truth for *why* each regex looks the way it does;
// see its module docstring for how the HTML encodes a frame.

// Diagram rows are rendered back-row-first (4,3,2,1). Map to USBC pin numbers.
const PIN_ROWS: number[][] = [[7, 8, 9, 10], [4, 5, 6], [2, 3], [1]]

const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7,
  august: 8, september: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9,
  oct: 10, nov: 11, dec: 12,
}
const MON_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export type PinState = 'down_first' | 'down_second' | 'standing'
export type PinDiagram = Record<string, PinState>

export interface LanetalkThrow {
  display: string
  pins: number | null
  split: boolean
}

export interface LanetalkFrame {
  frame: number
  throws: LanetalkThrow[]
  cumulative_score: number | null
  is_strike: boolean
  is_spare: boolean
  is_split: boolean
  pin_diagrams: PinDiagram[]
}

export interface LanetalkGame {
  game_number: number
  score: number | null
  date: string | null
  date_label: string | null
  played_at: string | null
  source_url: string | null
  frames: LanetalkFrame[]
}

export interface LanetalkSession {
  source_url: string | null
  title: string
  player: string
  bowling_center: { name: string; location: string }
  datetime_text: string
  played_at: string | null
  date: string | null
  date_label: string | null
  summary: { games: number | null; total: number | null; average: number | null }
  games: LanetalkGame[]
}

function first(pattern: string, text: string, group = 1, def: string | null = null, flags = ''): string | null {
  const m = new RegExp(pattern, flags).exec(text)
  return m && m[group] != null ? m[group].trim() : def
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

interface ParsedDateTime { year: number; month: number; day: number; iso: string }

/** '1:28 AM on Tuesday, June 09, 2026' -> parts, or null. */
function parseDateTime(text: string): ParsedDateTime | null {
  if (!text) return null
  const cleaned = text.trim().replace(/^(.*?) on \w+, (.*)$/, '$1 $2')
  const m = /^(\d{1,2}):(\d{2})\s*(AM|PM)\s+([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/i.exec(cleaned)
  if (!m) return null
  const month = MONTHS[m[4].toLowerCase()]
  if (!month) return null
  let hour = parseInt(m[1], 10)
  const minute = parseInt(m[2], 10)
  const ampm = m[3].toUpperCase()
  if (ampm === 'PM' && hour !== 12) hour += 12
  if (ampm === 'AM' && hour === 12) hour = 0
  const day = parseInt(m[5], 10)
  const year = parseInt(m[6], 10)
  const iso = `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:00`
  return { year, month, day, iso }
}

/** The Monday of the week a date belongs to (league night). */
function toMonday(dt: ParsedDateTime | null): { date: string; label: string } | null {
  if (!dt) return null
  const d = new Date(Date.UTC(dt.year, dt.month - 1, dt.day))
  const weekday = (d.getUTCDay() + 6) % 7 // Monday == 0
  const monday = new Date(d.getTime() - weekday * 86400000)
  const y = monday.getUTCFullYear()
  const m = monday.getUTCMonth() + 1
  const day = monday.getUTCDate()
  return { date: `${y}-${pad(m)}-${pad(day)}`, label: `${MON_ABBR[m - 1]} ${day}, ${y}` }
}

function parseHeader(html: string) {
  const title = first('og:title"\\s+content="([^"]+)"', html, 1, '') as string
  const player = first('<div class="user">\\s*<h1>([^<]+)</h1>', html, 1, '') as string
  const datetimeText = first('<div class="second-column">\\s*<h2>([^<]+)</h2>', html, 1, '') as string
  const center = first('class="name">([^<]+)</h2>', html, 1, '') as string
  let place = first('class="place">([^<]+)</h2>', html, 1, '') as string
  if (place) place = place.replace(/^[,\s]+/, '').trim()

  const games = first('<span>Games</span>\\s*<h2>(\\d+)</h2>', html)
  const total = first('<span>Total</span>\\s*<h2>(\\d+)</h2>', html)
  const average = first('<span>Average</span>\\s*<h2>(\\d+)</h2>', html)

  const dt = parseDateTime(datetimeText)
  const monday = toMonday(dt)
  return {
    title,
    player,
    bowling_center: { name: center, location: place },
    datetime_text: datetimeText,
    played_at: dt ? dt.iso : null,
    date: monday ? monday.date : null,
    date_label: monday ? monday.label : null,
    summary: {
      games: games ? parseInt(games, 10) : null,
      total: total ? parseInt(total, 10) : null,
      average: average ? parseInt(average, 10) : null,
    },
  }
}

function parsePinDiagram(block: string): PinDiagram {
  const rows = block.split(/class="fullGames-row">/).slice(1)
  const state: PinDiagram = {}
  rows.slice(0, 4).forEach((rowHtml, rowIdx) => {
    const pins = [...rowHtml.matchAll(/<div class="(fullGames-pin[^"]*)"><\/div>/g)].map(m => m[1])
    const numbers = PIN_ROWS[rowIdx]
    pins.slice(0, numbers.length).forEach((cls, pinIdx) => {
      let s: PinState
      if (cls.includes('fullGames-pin-white')) s = 'standing'
      else if (cls.includes('fullGames-pin-oval')) s = 'down_second'
      else s = 'down_first'
      state[numbers[pinIdx]] = s
    })
  })
  return state
}

function tokenToPins(token: string): number | null {
  if (token === 'X') return 10
  if (token === '/') return null
  if (token === '-') return 0
  if (/^\d+$/.test(token)) return parseInt(token, 10)
  return null
}

function parseThrows(throwsHtml: string, priorPins = 0): LanetalkThrow[] {
  const balls: LanetalkThrow[] = []
  let running = priorPins
  const re = /<span style="([^"]*font-size: 20px[^"]*)">\s*([^<]*?)\s*<\/span>|<div class="triangle">/g
  for (const m of throwsHtml.matchAll(re)) {
    if (m[0].startsWith('<div')) {
      const pins = 10 - running
      balls.push({ display: '/', pins, split: false })
      running = 10
      continue
    }
    const token = (m[2] || '').trim()
    if (token === '') continue
    const pins = tokenToPins(token)
    balls.push({ display: token, pins, split: (m[1] || '').includes('border: 2px solid red') })
    running += pins || 0
  }
  return balls
}

function parseFrame(frameHtml: string, frameNumber: number): LanetalkFrame {
  const pinBlocks = frameHtml.split(/<div class="pins">/).slice(1)
  const diagrams = pinBlocks.map(parsePinDiagram)

  const balls: LanetalkThrow[] = []
  let running = 0
  for (const m of frameHtml.matchAll(/<div class="throws">(.*?)<\/div>\s*(?:<div class="score"|<\/div>)/gs)) {
    const blockBalls = parseThrows(m[1], running)
    balls.push(...blockBalls)
    for (const b of blockBalls) running = b.pins === 10 ? 0 : running + (b.pins || 0)
  }

  const score = first('<div class="score">\\s*<span>(\\d+)</span>', frameHtml)
  const isStrike = balls.some(b => b.display === 'X')
  let isSpare = !isStrike && balls.some(b => b.display === '/')
  if (!isStrike && !isSpare && frameNumber <= 9 && balls.length >= 2) {
    const p0 = balls[0].pins
    const p1 = balls[1].pins
    if (p0 != null && p1 != null && p0 + p1 === 10) isSpare = true
  }

  return {
    frame: frameNumber,
    throws: balls,
    cumulative_score: score ? parseInt(score, 10) : null,
    is_strike: isStrike,
    is_spare: isSpare,
    is_split: balls.some(b => b.split),
    pin_diagrams: diagrams,
  }
}

function parseGame(gameNumber: number, body: string): LanetalkGame {
  const boxes = [...body.matchAll(/<div class="box">\s*<span[^>]*>(\d+)<\/span>/g)]
  const frames: LanetalkFrame[] = []
  boxes.forEach((m, i) => {
    const start = m.index!
    const end = i + 1 < boxes.length ? boxes[i + 1].index! : body.length
    frames.push(parseFrame(body.slice(start, end), parseInt(m[1], 10)))
  })
  const finalScore = frames.length ? frames[frames.length - 1].cumulative_score : null
  return { game_number: gameNumber, score: finalScore, date: null, date_label: null, played_at: null, source_url: null, frames }
}

export function parseLanetalk(html: string, sourceUrl: string | null = null): LanetalkSession {
  const header = parseHeader(html)

  // Split into game sections by their headings.
  const parts = html.split(/title-headlines">Game (\d+)</)
  const games: LanetalkGame[] = []
  for (let i = 1; i < parts.length; i += 2) {
    const gameNumber = parseInt(parts[i], 10)
    const game = parseGame(gameNumber, parts[i + 1])
    game.date = header.date
    game.date_label = header.date_label
    game.played_at = header.played_at
    game.source_url = sourceUrl
    games.push(game)
  }

  return { source_url: sourceUrl, ...header, games }
}
