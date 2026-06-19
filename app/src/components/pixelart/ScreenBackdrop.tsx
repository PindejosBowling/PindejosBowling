import { Fragment, type ReactNode } from 'react'
import LoadingView from '../ui/LoadingView'

interface Props {
  // The screen's pixel-art backdrop element (e.g. <PvPShootoutBackdrop />).
  backdrop: ReactNode
  // The screen's data-loading flag.
  loading: boolean
  // Label under the (delayed) spinner. Defaults to the app-wide 'Loading…'.
  loadingLabel?: string
  // The loaded foreground — header, scroll view, etc.
  children: ReactNode
}

// Mounts a screen's backdrop exactly ONCE and gates the foreground on loading.
//
// THE INVARIANT THIS ENFORCES: a backdrop must never be unmounted on the
// load→ready transition. The old pattern early-returned a separate tree while
// loading (`if (loading) return <Container><Backdrop/><spinner/></Container>`)
// and mounted the backdrop a SECOND time in the loaded return. React tears the
// first instance down and builds the second from scratch, so the procedural
// field re-measures and rebuilds in two visible phases — first sized to the
// viewport, then to the real content (most jarring on the scroll-length depth
// fields, where the band positions are a fraction of the measured height).
//
// By rendering the backdrop in the same tree position regardless of `loading`
// and only swapping the sibling foreground, the backdrop reconciles as one
// stable instance and measures once. Returns a Fragment so it adds no layout
// box: drop it directly inside the screen's container (the SafeAreaView for
// fixed scenes, or the ScrollView for scroll-length fields — see
// pixelart/config.ts for which mounting each backdrop wants).
export default function ScreenBackdrop({ backdrop, loading, loadingLabel = 'Loading…', children }: Props) {
  return (
    <Fragment>
      {backdrop}
      {loading ? <LoadingView label={loadingLabel} transparent delayed /> : children}
    </Fragment>
  )
}
