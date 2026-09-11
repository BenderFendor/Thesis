declare module "code-multivitals" {
  interface CodeMultivitalsThresholds {
    readonly cognitiveComplexity: Readonly<{ error: number; warn: number }>;
    readonly functionLength: Readonly<{ error: number; warn: number }>;
    readonly halsteadVolume: Readonly<{ error: number; warn: number }>;
    readonly cyclomaticComplexity: Readonly<{ error: number; warn: number }>;
    readonly nestingDepth: Readonly<{ error: number; warn: number }>;
  }

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

  export const DEFAULT_THRESHOLDS: CodeMultivitalsThresholds;

  export function analyseFile(
    path: string,
    thresholds: CodeMultivitalsThresholds,
  ): CodeMultivitalsFile;

  export function analyse(
    paths: readonly string[],
    options: Readonly<Record<string, never>>,
  ): CodeMultivitalsResult;
}
