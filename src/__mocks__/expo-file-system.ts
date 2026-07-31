/**
 * A stub for `expo-file-system` under the plain-Node test runner.
 *
 * The real module is untranspiled ESM and this runner is deliberately
 * preset-free (see jest.config.js). Only the two names `community-seed.ts`
 * imports are provided, and only the one property it reads: an image upload
 * needs a `file://` URI and nothing else.
 *
 * If a test ever needs to assert on real file behaviour, that test wants
 * jest-expo, not a richer fake here — a stub that grows features nobody
 * verifies is how a suite starts passing against a filesystem that does not
 * behave like the one shipped.
 */
export const Paths = { document: 'file:///documents' };

export class File {
  readonly uri: string;

  constructor(directory: { document?: string } | string, name: string) {
    const base = typeof directory === 'string' ? directory : (directory.document ?? '');
    this.uri = `${base.replace(/\/$/, '')}/${name}`;
  }
}

export class Directory {
  constructor(readonly uri: string) {}
  list(): { name: string }[] {
    return [];
  }
}
