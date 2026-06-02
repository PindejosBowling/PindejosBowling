export function initials(name: string | null | undefined): string {
  if (!name) return '?'
  return name.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase()
}

export function timeAgo(date: string | Date): string {
  const d = new Date(date)
  const s = Math.floor((Date.now() - d.getTime()) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return Math.floor(s / 60) + 'm ago'
  if (s < 86400) return Math.floor(s / 3600) + 'h ago'
  if (s < 604800) return Math.floor(s / 86400) + 'd ago'
  return d.toLocaleDateString()
}

export function combinations<T>(arr: T[], k: number): T[][] {
  if (k > arr.length) return []
  if (k === 1) return arr.map(x => [x])
  const out: T[][] = []
  for (let i = 0; i <= arr.length - k; i++) {
    const rest = combinations(arr.slice(i + 1), k - 1)
    rest.forEach(r => out.push([arr[i], ...r]))
  }
  return out
}

type MoneylineResult = { fav: string; dog: string }
type SpreadMLResult = {
  fav: 't1' | 't2' | 'tie'
  spread: number
  ml: MoneylineResult
}

export function spreadAndML(t1: number, t2: number): SpreadMLResult {
  const diff = t1 - t2
  const fav: 't1' | 't2' | 'tie' = diff > 0 ? 't1' : diff < 0 ? 't2' : 'tie'
  const spread = Math.abs(diff)
  const ml = (d: number): MoneylineResult => {
    const a = Math.abs(d)
    if (a === 0) return { fav: 'EVEN', dog: 'EVEN' }
    if (a < 4)   return { fav: '-115',  dog: '-105' }
    if (a < 8)   return { fav: '-135',  dog: '+115' }
    if (a < 14)  return { fav: '-160',  dog: '+140' }
    if (a < 22)  return { fav: '-200',  dog: '+170' }
    if (a < 32)  return { fav: '-240',  dog: '+200' }
    if (a < 45)  return { fav: '-300',  dog: '+240' }
    return             { fav: '-380',  dog: '+300' }
  }
  return { fav, spread, ml: ml(diff) }
}
