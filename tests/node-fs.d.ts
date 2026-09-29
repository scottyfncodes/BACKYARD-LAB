// The little bit of Node the PWA test reads files with (the project has no @types/node).
declare module 'node:fs' {
  interface Bytes extends Uint8Array {
    readUInt32BE(offset: number): number;
    subarray(start?: number, end?: number): Bytes;
    toString(encoding?: string): string;
  }
  export function readFileSync(path: string): Bytes;
  export function existsSync(path: string): boolean;
}
