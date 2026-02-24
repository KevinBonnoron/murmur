declare module 'espeak-ng' {
  export interface ESpeakModule {
    FS: {
      readFile(path: string, opts: { encoding: string }): string;
    };
  }

  interface ESpeakOptions {
    arguments: string[];
    locateFile?(path: string): string;
    onRuntimeInitialized(this: ESpeakModule): void;
    onAbort?(reason: unknown): void;
  }

  function createEspeak(opts: ESpeakOptions): void;
  export default createEspeak;
}
