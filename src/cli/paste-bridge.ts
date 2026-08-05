import { StringDecoder } from 'node:string_decoder';

const PASTE_START = '\x1b[200~';
const PASTE_END = '\x1b[201~';

export interface PasteDecoder {
  /** Feed one raw chunk; returns keystrokes to buffer plus atomic paste writes. */
  push(chunk: Buffer): { keystrokes: string; pastes: string[] };
  /** True while inside a bracketed-paste region awaiting the end marker. */
  readonly inBracketed: boolean;
  /** Trailing bytes still buffered (partial escape / marker prefix). */
  readonly pending: string;
}

/**
 * A UTF-8-safe transparent bridge for interactive attach input.
 *
 * The local terminal renders and handles keys/paste itself (that is CoTerm's
 * contract with a real terminal). This layer only shepherds raw bytes toward
 * the session while fixing the two things a naive per-chunk forwarding breaks:
 *
 *  1. Multi-byte UTF-8 split across data events -> garbage. We decode with a
 *     StringDecoder, not `chunk.toString()`.
 *  2. Bracketed paste: the terminal (Windows Terminal, and many others) wraps
 *     pasted text in ESC[200~ ... ESC[201~. We strip the wrapper and emit the
 *     inner bytes as ONE atomic paste (the real terminal already pasted it), so
 *     Ctrl+V and right-click paste behave identically and never trigger the
 *     idle-flush mid-paste.
 */
export function createPasteDecoder(): PasteDecoder {
  const decoder = new StringDecoder('utf8');

  let pending = '';
  let bracketed = false;

  // If `pending` ends with a proper prefix of a marker (e.g. "\x1b[20" from a
  // "\x1b[200~" whose rest arrives in the next data event), hold that tail back
  // so it is never flushed as literal keystrokes.
  const stripPartialMarker = (text: string, marker: string): { keep: string; hold: string } => {
    const max = Math.min(marker.length - 1, text.length);
    for (let len = max; len > 0; len--) {
      if (marker.startsWith(text.slice(-len))) {
        return { keep: text.slice(0, text.length - len), hold: text.slice(-len) };
      }
    }
    return { keep: text, hold: '' };
  };

  const push = (chunk: Buffer): { keystrokes: string; pastes: string[] } => {
    pending += decoder.write(chunk);
    const keystrokes: string[] = [];
    const pastes: string[] = [];

    while (true) {
      if (bracketed) {
        const end = pending.indexOf(PASTE_END);
        if (end < 0) return { keystrokes: keystrokes.join(''), pastes }; // wait for the rest
        const text = pending.slice(0, end);
        pending = pending.slice(end + PASTE_END.length);
        bracketed = false;
        if (text) pastes.push(text);
        continue;
      }
      const start = pending.indexOf(PASTE_START);
      if (start < 0) {
        const { keep, hold } = stripPartialMarker(pending, PASTE_START);
        keystrokes.push(keep);
        pending = hold;
        return { keystrokes: keystrokes.join(''), pastes };
      }
      keystrokes.push(pending.slice(0, start));
      pending = pending.slice(start + PASTE_START.length);
      bracketed = true;
    }
  };

  return {
    push,
    get inBracketed() {
      return bracketed;
    },
    get pending() {
      return pending;
    },
  };
}