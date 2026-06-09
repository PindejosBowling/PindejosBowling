#!/usr/bin/env python3
"""
parse_lanetalk.py — Extract frame-level bowling data from a Lanetalk
"shared session" HTML page into structured JSON.

Source pages look like:
    http://shared.lanetalk.com/<hash>
e.g. http://shared.lanetalk.com/fdd40824dc6635475db40523a6b830781b406df5

Usage:
    # Parse a local HTML file
    python3 parse_lanetalk.py 3_game_JR_20260608.html > out.json

    # Fetch + parse directly from a Lanetalk share URL
    python3 parse_lanetalk.py --url http://shared.lanetalk.com/<hash> > out.json

    # Write to a file instead of stdout
    python3 parse_lanetalk.py input.html -o out.json

Only the Python standard library is used (no bs4/lxml/requests required).

------------------------------------------------------------------------------
How the HTML encodes a frame (the part that matters)
------------------------------------------------------------------------------
Each game is a `Game N` heading followed by ten `<div class="box">N</div>`
frame markers. For every frame the page renders:

  * A pin diagram (`<div class="pins">` containing four `fullGames-row`s of
    4 / 3 / 2 / 1 pins, i.e. the back row first). Each pin <div> carries a
    class that encodes its fate:
        - plain  `fullGames-pin`            -> knocked down on the FIRST ball
        - oval   `fullGames-pin-oval`       -> knocked down on the SECOND ball
        - white  `fullGames-pin-white`      -> still STANDING at end of frame
    The page legend calls black "knocked down with the first throw" and white
    "pins left after the first throw"; verified against the throw counts across
    all sample frames (black == ball-1 pins, oval == ball-2 pins, white == pins
    left standing).

  * The thrown ball values (`<div class="throws">`) as spans:
        - a digit 0-9                       -> pins felled by that ball
        - "X"                               -> strike (10)  (white-on-black box)
        - "/"                               -> spare        (defensive; unseen in sample)
        - "-"                               -> miss / gutter (0)
        - a span with `border: 2px solid red` (red circle) -> SPLIT on that ball

  * The running `<div class="score">` cumulative total for the frame.

The 10th frame wraps its (2-3) balls in `<div class="frames">` with one
`<div class="internal-frame">` per ball, so it has one pin diagram per ball
rather than one per frame.

Pin numbering: the diagram's rows map to the standard USBC pin layout with the
back row first:  row of 4 = pins 7,8,9,10 ; row of 3 = 4,5,6 ; row of 2 = 2,3 ;
row of 1 = 1 (head pin).
"""

import argparse
import json
import re
import sys
import urllib.request


# Diagram rows are rendered back-row-first (4,3,2,1). Map to USBC pin numbers.
PIN_ROWS = [[7, 8, 9, 10], [4, 5, 6], [2, 3], [1]]


def fetch(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.read().decode("utf-8", errors="replace")


def _first(pattern, text, group=1, default=None, flags=0):
    m = re.search(pattern, text, flags)
    return m.group(group).strip() if m else default


def parse_header(html: str) -> dict:
    """Pull the overview / session metadata from the page head + Overview section."""
    title = _first(r'og:title"\s+content="([^"]+)"', html, default="")
    player = _first(r'<div class="user">\s*<h1>([^<]+)</h1>', html, default="")
    datetime_text = _first(r'<div class="second-column">\s*<h2>([^<]+)</h2>', html, default="")
    center = _first(r'class="name">([^<]+)</h2>', html, default="")
    place = _first(r'class="place">([^<]+)</h2>', html, default="")
    if place:
        place = place.lstrip(", ").strip()

    # Overview summary cards: Games / Total / Average
    games = _first(r'<span>Games</span>\s*<h2>(\d+)</h2>', html)
    total = _first(r'<span>Total</span>\s*<h2>(\d+)</h2>', html)
    average = _first(r'<span>Average</span>\s*<h2>(\d+)</h2>', html)

    return {
        "title": title,
        "player": player,
        "bowling_center": {"name": center, "location": place},
        "datetime_text": datetime_text,
        "datetime_iso": _to_iso(datetime_text),
        "summary": {
            "games": int(games) if games else None,
            "total": int(total) if total else None,
            "average": int(average) if average else None,
        },
    }


def _to_iso(text: str):
    """'1:28 AM on Tuesday, June 09, 2026' -> '2026-06-09T01:28:00'."""
    if not text:
        return None
    from datetime import datetime
    cleaned = re.sub(r"^(.*?) on \w+, (.*)$", r"\1 \2", text.strip())
    for fmt in ("%I:%M %p %B %d, %Y", "%I:%M %p %b %d, %Y"):
        try:
            return datetime.strptime(cleaned, fmt).isoformat()
        except ValueError:
            continue
    return None


def parse_pin_diagram(block: str) -> dict:
    """A single pin-diagram segment -> {pin_number: state}.

    `block` is the HTML following a `<div class="pins">` marker (up to the next
    such marker), containing four `fullGames-row` groups of 4/3/2/1 pins.
    state in {"down_first", "down_second", "standing"}.
    """
    rows = re.split(r'class="fullGames-row">', block)[1:]

    state = {}
    for row_idx, row_html in enumerate(rows[:4]):
        pins = re.findall(r'<div class="(fullGames-pin[^"]*)"></div>', row_html)
        numbers = PIN_ROWS[row_idx]
        for pin_idx, cls in enumerate(pins[: len(numbers)]):
            if "fullGames-pin-white" in cls:
                s = "standing"      # filled-white pin = left standing at end of frame
            elif "fullGames-pin-oval" in cls:
                s = "down_second"   # outline pin = knocked down on the second ball
            else:
                s = "down_first"    # solid black pin = knocked down on the first ball
            state[numbers[pin_idx]] = s
    return state


def parse_throws(throws_html: str, prior_pins: int = 0) -> list:
    """A `<div class="throws">` block -> ordered list of ball dicts.

    Each ball: {"display", "pins", "split"} where display is the on-screen
    token (digit / "X" / "/" / "-"), pins is the integer pins felled, and
    split flags the red-circled-count split indicator.

    `prior_pins` is the pins already felled earlier in the same frame; it lets a
    spare (rendered as a `triangle` glyph, not text) resolve to `10 - prior`.
    Tokens are read in document order so a span followed by a triangle yields
    the first ball then the spare.
    """
    balls = []
    running = prior_pins
    # Walk spans and triangle markers in the order they appear.
    for m in re.finditer(r'<span style="([^"]*font-size: 20px[^"]*)">\s*([^<]*?)\s*</span>'
                         r'|<div class="triangle">', throws_html):
        if m.group(0).startswith('<div'):
            # Spare marker: completes the rack relative to what's already down.
            pins = 10 - running
            balls.append({"display": "/", "pins": pins, "split": False})
            running = 10
            continue
        token = (m.group(2) or "").strip()
        if token == "":
            continue
        pins = _token_to_pins(token)
        balls.append({
            "display": token,
            "pins": pins,
            "split": "border: 2px solid red" in m.group(1),
        })
        running += pins or 0
    return balls


def _token_to_pins(token: str):
    if token == "X":
        return 10
    if token == "/":
        return None  # spare value depends on previous ball; caller can resolve
    if token == "-":
        return 0
    if token.isdigit():
        return int(token)
    return None


def parse_frame(frame_html: str, frame_number: int) -> dict:
    """Parse one frame slice (works for frames 1-9 and the 10th)."""
    # All pin diagrams in this frame (1 for frames 1-9, one per ball in the 10th).
    # Each diagram is the segment following a `<div class="pins">` marker; the
    # trailing throws/score markup is ignored since we only read fullGames-rows.
    pin_blocks = re.split(r'<div class="pins">', frame_html)[1:]
    diagrams = [parse_pin_diagram(b) for b in pin_blocks]

    # Throw values across the whole frame (the 10th has several throws blocks).
    # A strike (or in the 10th, completing the rack) resets the running count
    # the spare glyph is measured against.
    balls = []
    running = 0
    for throws_html in re.findall(r'<div class="throws">(.*?)</div>\s*(?:<div class="score"|</div>)',
                                  frame_html, re.S):
        block_balls = parse_throws(throws_html, prior_pins=running)
        balls.extend(block_balls)
        for b in block_balls:
            running = 0 if b["pins"] == 10 else running + (b["pins"] or 0)

    # Cumulative running score for the frame.
    score = _first(r'<div class="score">\s*<span>(\d+)</span>', frame_html)

    is_strike = any(b["display"] == "X" for b in balls)
    # A spare: not a strike, but the first two balls clear all ten pins. Detect
    # via the "/" token or, for frames 1-9, by the first two balls summing to 10.
    is_spare = (not is_strike) and any(b["display"] == "/" for b in balls)
    if not is_strike and not is_spare and frame_number <= 9 and len(balls) >= 2:
        p0, p1 = balls[0]["pins"], balls[1]["pins"]
        if p0 is not None and p1 is not None and p0 + p1 == 10:
            is_spare = True

    return {
        "frame": frame_number,
        "throws": balls,
        "cumulative_score": int(score) if score else None,
        "is_strike": is_strike,
        "is_spare": is_spare,
        "is_split": any(b["split"] for b in balls),
        "pin_diagrams": diagrams,
    }


def parse_game(game_number: int, body: str) -> dict:
    """Slice a game body into its ten frames by the `box` frame markers."""
    box_iter = list(re.finditer(r'<div class="box">\s*<span[^>]*>(\d+)</span>', body))
    frames = []
    for i, m in enumerate(box_iter):
        start = m.start()
        end = box_iter[i + 1].start() if i + 1 < len(box_iter) else len(body)
        frame_number = int(m.group(1))
        frames.append(parse_frame(body[start:end], frame_number))

    final_score = frames[-1]["cumulative_score"] if frames else None
    return {"game_number": game_number, "score": final_score, "frames": frames}


def parse(html: str, source_url: str = None) -> dict:
    result = {"source_url": source_url}
    result.update(parse_header(html))

    # Split into game sections by their headings; restrict to the games container.
    parts = re.split(r'title-headlines">Game (\d+)<', html)
    games = []
    for i in range(1, len(parts), 2):
        game_number = int(parts[i])
        games.append(parse_game(game_number, parts[i + 1]))
    result["games"] = games
    return result


def main(argv=None):
    ap = argparse.ArgumentParser(description="Parse Lanetalk shared-session HTML to JSON.")
    ap.add_argument("input", nargs="?", help="Path to a saved HTML file.")
    ap.add_argument("--url", help="Fetch the HTML from this Lanetalk share URL instead.")
    ap.add_argument("-o", "--output", help="Write JSON here (default: stdout).")
    ap.add_argument("--indent", type=int, default=2, help="JSON indent (default 2).")
    args = ap.parse_args(argv)

    if args.url:
        html = fetch(args.url)
        source_url = args.url
    elif args.input:
        with open(args.input, encoding="utf-8") as fh:
            html = fh.read()
        source_url = None
    else:
        ap.error("provide an input HTML file or --url")

    data = parse(html, source_url=source_url)
    text = json.dumps(data, indent=args.indent, ensure_ascii=False)

    if args.output:
        with open(args.output, "w", encoding="utf-8") as fh:
            fh.write(text + "\n")
    else:
        sys.stdout.write(text + "\n")


if __name__ == "__main__":
    main()
