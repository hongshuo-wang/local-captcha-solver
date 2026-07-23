import { randomUUID } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';

const defaultFs = { mkdir, rename, rm, writeFile };

function describeError(error) {
  return error instanceof Error ? error.message : String(error);
}

function isNotFound(error) {
  return error !== null && typeof error === 'object' && error.code === 'ENOENT';
}

async function removeArtifacts(paths, fs) {
  const errors = [];
  for (const path of paths) {
    try {
      await fs.rm(path, { force: true });
    } catch (error) {
      errors.push(error);
    }
  }
  return errors;
}

function throwWithRecoveryErrors(message, primaryError, recoveryErrors) {
  if (recoveryErrors.length === 0) {
    throw primaryError;
  }

  throw new AggregateError(
    [primaryError, ...recoveryErrors],
    `${message}: ${describeError(primaryError)}; ${recoveryErrors.length} recovery operation(s) failed`,
  );
}

export async function replaceAssetSet(outputs, options = {}) {
  const fs = options.fs ?? defaultFs;
  const createId = options.createId ?? randomUUID;
  const transactionId = createId();
  const staged = [];

  try {
    for (const [index, output] of outputs.entries()) {
      const outputDirectory = dirname(output.outputPath);
      await fs.mkdir(outputDirectory, { recursive: true });
      const artifactStem = `.${basename(output.outputPath)}.${process.pid}.${transactionId}.${index}`;
      const item = {
        ...output,
        temporaryPath: resolve(outputDirectory, `${artifactStem}.tmp`),
        backupPath: resolve(outputDirectory, `${artifactStem}.backup`),
        hadOriginal: false,
        installed: false,
      };
      staged.push(item);
      await fs.writeFile(item.temporaryPath, item.bytes, { flag: 'wx' });
    }
  } catch (error) {
    const cleanupErrors = await removeArtifacts(
      staged.map((item) => item.temporaryPath),
      fs,
    );
    throwWithRecoveryErrors('Asset staging failed and cleanup was incomplete', error, cleanupErrors);
  }

  const applied = [];
  try {
    for (const item of staged) {
      try {
        await fs.rename(item.outputPath, item.backupPath);
        item.hadOriginal = true;
      } catch (error) {
        if (!isNotFound(error)) {
          throw error;
        }
      }

      applied.push(item);
      await fs.rename(item.temporaryPath, item.outputPath);
      item.installed = true;
    }
  } catch (error) {
    const rollbackErrors = [];
    for (const item of applied.reverse()) {
      try {
        await fs.rm(item.outputPath, { force: true });
        if (item.hadOriginal) {
          await fs.rename(item.backupPath, item.outputPath);
        }
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }

    rollbackErrors.push(
      ...(await removeArtifacts(
        staged.map((item) => item.temporaryPath),
        fs,
      )),
    );
    throwWithRecoveryErrors('Asset commit failed and rollback was incomplete', error, rollbackErrors);
  }

  const cleanupErrors = await removeArtifacts(
    staged.flatMap((item) => [item.temporaryPath, item.backupPath]),
    fs,
  );
  if (cleanupErrors.length > 0) {
    throw new AggregateError(cleanupErrors, 'Asset commit succeeded but cleanup was incomplete');
  }
}
