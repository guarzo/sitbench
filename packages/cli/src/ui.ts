import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import type { AnalyzePrompts, CandidateChoice } from './analyze-command.js';

export interface ConsolePrompts {
  prompts: AnalyzePrompts;
  close(): void;
}

/** Creates the small terminal UI used by the executable boundary. */
export function createConsolePrompts(): ConsolePrompts {
  const terminal = createInterface({ input: stdin, output: stdout });

  return {
    prompts: {
      async confirmCandidate({ candidate, candidates }): Promise<CandidateChoice> {
        const answer = (await terminal.question(
          `Use ${candidate.start} to ${candidate.end}? [a]ccept, [e]dit, [s]elect, [c]ancel: `,
        )).trim().toLowerCase();
        if (answer === 'e' || answer === 'edit') {
          const start = await terminal.question('Adjusted start (ISO timestamp): ');
          const end = await terminal.question('Adjusted end (ISO timestamp): ');
          return { action: 'adjust', start: start.trim(), end: end.trim() };
        }
        if (answer === 's' || answer === 'select') {
          const selected = await terminal.question(`Candidate number (1-${candidates.length}, newest is ${candidates.length}): `);
          return { action: 'select', index: Number(selected) - 1 };
        }
        if (answer === 'a' || answer === 'accept' || answer === '') {
          return { action: 'accept' };
        }
        return { action: 'cancel' };
      },
      async requestSite(initial): Promise<string> {
        return (await terminal.question(`Site${initial === undefined ? '' : ` [${initial}]`}: `)).trim() || initial || '';
      },
      async requestProfile(profiles, initial): Promise<string> {
        if (profiles.length > 0) {
          stdout.write(`Saved profiles: ${profiles.map((profile) => profile.name).join(', ')}\n`);
        }
        return (await terminal.question(`Fleet profile${initial === undefined ? '' : ` [${initial}]`}: `)).trim() || initial || '';
      },
      async requestNotes(): Promise<string | null> {
        const notes = (await terminal.question('Notes (optional): ')).trim();
        return notes || null;
      },
      async confirmSave(): Promise<boolean> {
        const answer = (await terminal.question('Save this run? [y/N]: ')).trim().toLowerCase();
        return answer === 'y' || answer === 'yes';
      },
    },
    close: () => terminal.close(),
  };
}
