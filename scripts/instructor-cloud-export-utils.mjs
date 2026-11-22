import { writeFile } from 'node:fs/promises';

/** Discover the local bridge asset, keeping a content-version query out of its filesystem path. */
export function cloudBridgePath(html) {
  const paths = new Set([...html.matchAll(/(['"])(\/rhoda\/assets\/authRequest-[\w-]+\.js)(?:\?v=[a-fA-F0-9]+)?\1/g)]
    .map(match => match[2]));
  if (paths.size !== 1) throw Error('Cannot identify one existing cloud authentication bridge.');
  return [...paths][0];
}

/** A later export must not replace Cloud-specific auth/versioning build extensions. */
export async function createCloudBuildIfMissing(file, initialSource) {
  try {
    await writeFile(file, initialSource, { flag: 'wx' });
    return true;
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    return false;
  }
}
