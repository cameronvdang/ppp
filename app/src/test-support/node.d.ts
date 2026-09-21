// Minimal built-in types used by Node-only tests. The offline workspace does not
// include @types/node; browser source must not import these modules.
declare const __dirname: string
declare module 'node:fs' {
  export function readdirSync(path: string): string[]
  export function readFileSync(path: string, encoding: 'utf8'): string
  export function statSync(path: string): { isDirectory(): boolean; size: number }
}
declare module 'node:path' {
  export function join(...paths: string[]): string
  export function resolve(...paths: string[]): string
}
