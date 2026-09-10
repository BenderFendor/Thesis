declare module "code-multivitals" {
  interface CodeMultivitalsFunction {
    readonly maintainabilityIndex?: number;
    readonly name?: string;
    readonly startLine?: number;
  }

  interface CodeMultivitalsFile {
    readonly filePath: string;
    readonly functions?: readonly CodeMultivitalsFunction[];
  }

  interface CodeMultivitalsResult {
    readonly files?: readonly CodeMultivitalsFile[];
  }

  export function analyse(
    paths: readonly string[],
    options: Readonly<Record<string, never>>,
  ): CodeMultivitalsResult;
}
