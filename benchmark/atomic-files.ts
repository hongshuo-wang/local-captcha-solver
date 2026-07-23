import * as nodeFs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export interface AtomicReplacement {
  readonly stagedPath: string;
  readonly targetPath: string;
}

export interface AtomicFileOperations {
  access(filePath: string): Promise<void>;
  rename(source: string, destination: string): Promise<void>;
  rm(filePath: string, options: { recursive: boolean; force: boolean }): Promise<void>;
}

const defaultOperations: AtomicFileOperations = {
  access: nodeFs.access,
  rename: nodeFs.rename,
  rm: nodeFs.rm,
};

async function exists(filePath: string, operations: AtomicFileOperations): Promise<boolean> {
  try {
    await operations.access(filePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

export async function replaceAtomically(
  replacements: readonly AtomicReplacement[],
  operations: AtomicFileOperations = defaultOperations,
): Promise<void> {
  const transaction = randomUUID();
  const entries = replacements.map((replacement) => ({
    ...replacement,
    backupPath: path.join(
      path.dirname(replacement.targetPath),
      `.${path.basename(replacement.targetPath)}.backup-${transaction}`,
    ),
    hadTarget: false,
    committed: false,
  }));

  try {
    for (const entry of entries) {
      entry.hadTarget = await exists(entry.targetPath, operations);
      if (entry.hadTarget) {
        await operations.rename(entry.targetPath, entry.backupPath);
      }
    }
    for (const entry of entries) {
      await operations.rename(entry.stagedPath, entry.targetPath);
      entry.committed = true;
    }
  } catch (error) {
    for (const entry of [...entries].reverse()) {
      if (entry.committed) {
        await operations.rm(entry.targetPath, { recursive: true, force: true });
      }
      if (entry.hadTarget && await exists(entry.backupPath, operations)) {
        await operations.rename(entry.backupPath, entry.targetPath);
      }
    }
    throw error;
  } finally {
    await Promise.all(entries.flatMap((entry) => [
      operations.rm(entry.stagedPath, { recursive: true, force: true }),
      operations.rm(entry.backupPath, { recursive: true, force: true }),
    ]));
  }
}
