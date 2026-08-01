import type { ScreenLine, SessionSnapshot } from '../core/types.js';
import type { Session } from '../core/session.js';

export function createSnapshot(session: Session): SessionSnapshot {
  return {
    id: session.id,
    name: session.name,
    shell: session.config.shell,
    shellArgs: session.config.shellArgs,
    cwd: session.config.cwd,
    cols: session.config.cols,
    rows: session.config.rows,
    env: session.config.env,
    createdAt: session.createdAt,
    owner: session.owner,
    state: session.state,
    prompt: session.getCurrentPrompt(),
    screenLines: session.screenBuffer ? session.screenBuffer.getScrollback() : [],
    intelligence: session.getIntelligenceState(),
  };
}

export function applySnapshot(session: Session, snapshot: SessionSnapshot): void {
  if (session.screenBuffer && snapshot.screenLines.length > 0) {
    for (const line of snapshot.screenLines) {
      session.screenBuffer.append(line.rawText);
    }
  }
  if (session.promptDetector && snapshot.prompt) {
    session.promptDetector.detect(snapshot.prompt);
  }
  if (session.intelligence) {
    session.intelligence.setCwd(snapshot.intelligence.cwd);
    for (const command of snapshot.intelligence.commands) {
      session.intelligence.commandTracker.record(command.command, command.requester);
      if (command.durationMs !== undefined || command.error !== undefined) {
        session.intelligence.commandTracker.complete(command.exitCode);
      }
    }
  }
}

export type { ScreenLine, SessionSnapshot };
