/**
 * No-inline-comments transform.
 * Moves trailing line comments (code followed by `// ...` on the same line)
 * onto their own line directly above the statement, satisfying the
 * no-inline-comments oxlint rule.
 *
 * Safety properties:
 * - Comments inside string literals, template literals (including `${...}`
 *   substitutions and multi-line templates), block comments, JSX text and
 *   regex literals are never moved.
 * - Regex literals and JSX text regions are located from the TypeScript AST
 *   (authoritative). String/template/block-comment state is tracked by a
 *   small per-character scanner.
 * - After rewriting, the file is re-parsed. If the parse error count grows,
 *   the file is left untouched (all-or-nothing edit safety).
 * - Idempotent: a moved comment sits on its own line, so a second run
 *   changes nothing.
 *
 * Usage: node scripts/transformations/no-inline-comments.mjs --file <path> [--dry]
 *
 * Contract: runTransform(sourceText, filePath) -> { changed: boolean, text: string }
 */
import { readFile, writeFile } from "node:fs/promises";
import tsModule from "../../frontend/node_modules/typescript/lib/typescript.js";

const
  DOUBLE_QUOTE = '"',
  EMPTY_STRING = "",
  ERROR_EXIT_CODE = 2,
  FAILURE_EXIT_CODE = 1,
  FIRST_INDEX = 0,
  INCREMENT = 1,
  LAST_INDEX = -1,
  LINE_FEED = "\n",
  MISSING_INDEX = -1,
  SINGLE_QUOTE = "'",
  STEP = 2,
  ts = (
    /** @type {typeof import("../../frontend/node_modules/typescript/lib/typescript.js")} */
    tsModule
  );

/**
 * Moves trailing inline line comments above their statements.
 */
class InlineCommentRewriter {
  /** @type {number} */
  static JSX_TEXT_KIND = ts.SyntaxKind.JsxText;

  /** @type {number} */
  static REGEX_LITERAL_KIND = ts.SyntaxKind.RegularExpressionLiteral;

  /** @type {Readonly<Record<string, (state: ScanState) => void | undefined>>} */
  static BlockCommentSteppers = Object.freeze({
    "*": (state) => {
      InlineCommentRewriter.maybeEndBlockComment(state);
    },
  });

  /** @type {Readonly<Record<string, (state: ScanState) => void>>} */
  static CodeSteppers = Object.freeze({
    [DOUBLE_QUOTE]: InlineCommentRewriter.openStringFrame,
    [SINGLE_QUOTE]: InlineCommentRewriter.openStringFrame,
    "/": InlineCommentRewriter.stepSlash,
    "\\": (state) => {
      InlineCommentRewriter.advanceOneChar(state);
    },
    "`": InlineCommentRewriter.openTemplateFrame,
  });

  /** @type {Readonly<Record<string, (state: ScanState) => void>>} */
  static ContextSteppers = Object.freeze({
    code: (state) => {
      InlineCommentRewriter.stepCode(state);
    },
    expr: (state) => {
      InlineCommentRewriter.stepCode(state);
    },
    string: (state) => {
      InlineCommentRewriter.stepString(state);
    },
    template: (state) => {
      InlineCommentRewriter.stepTemplate(state);
    },
  });

  /** @type {Readonly<Record<string, (state: ScanState) => void>>} */
  static StringSteppers = Object.freeze({
    "\\": (state) => {
      InlineCommentRewriter.skipEscapedCharacter(state);
    },
  });

  /** @type {Readonly<Record<string, (state: ScanState) => void>>} */
  static TemplateSteppers = Object.freeze({
    "$": (state) => {
      InlineCommentRewriter.maybeOpenExpression(state);
    },
    "\\": (state) => {
      InlineCommentRewriter.skipEscapedCharacter(state);
    },
    "`": (state) => {
      InlineCommentRewriter.closeFrame(state);
    },
  });

  /**
   * Advance one character, updating line bookkeeping on newlines.
   * @param {ScanState} state - Live scanner state.
   * @returns {void}
   */
  static advanceOneChar(state) {
    if (state.text[state.pos] === LINE_FEED) {
      InlineCommentRewriter.onNewlineAt(state, state.pos);
    }
    state.pos += INCREMENT;
  }

  /**
   * Apply one source edit.
   * @param {string} text - Source text being edited.
   * @param {Readonly<Edit>} edit - Edit to apply.
   * @returns {string} Text with the edit applied.
   */
  static applyEdit(text, edit) {
    if (edit.insert !== undefined) {
      return text.slice(FIRST_INDEX, edit.pos) + edit.insert + text.slice(edit.pos);
    }
    return text.slice(FIRST_INDEX, edit.pos) + text.slice(edit.delEnd ?? text.length);
  }

  /**
   * Apply a whole edit list sequentially.
   * @param {string} text - Source text being edited.
   * @param {ReadonlyArray<Readonly<Edit>>} edits - Edits to apply.
   * @returns {string} Text with all edits applied.
   */
  static applyEditSequence(text, edits) {
    let output = text;
    for (const edit of edits) {
      output = InlineCommentRewriter.applyEdit(output, edit);
    }
    return output;
  }

  /**
   * Apply one CLI argument to an options object.
   * @param {readonly string[]} argumentsList - Raw CLI arguments.
   * @param {number} index - Current argument index.
   * @param {CliOptions} options - Mutable options being filled.
   * @returns {number} Index of the next argument.
   */
  static applyCliArgument(argumentsList, index, options) {
    const argument = argumentsList[index];
    if (argument === "--file") {
      return InlineCommentRewriter.applyFileArgument(argumentsList, index, options);
    }
    if (argument === "--dry") {
      options.dry = true;
    }
    if (argument === "--help" || argument === "-h") {
      options.help = true;
    }
    return index + INCREMENT;
  }

  /**
   * Rebuild the source with each moved comment on its own line above the
   * statement, indented like that statement.
   * @param {string} text - Source text to rewrite.
   * @param {ReadonlyArray<Readonly<LineComment>>} comments - Comments to move.
   * @param {string} eol - Line terminator used by the file.
   * @returns {string} Rewritten source text.
   */
  static applyEdits(text, comments, eol) {
    const edits = comments.flatMap((comment) => InlineCommentRewriter.editsForComment(comment, text, eol));
    edits.sort(InlineCommentRewriter.compareEditPositions);
    return InlineCommentRewriter.applyEditSequence(text, edits);
  }

  /**
   * Apply a `--file <path>` argument to an options object.
   * @param {readonly string[]} argumentsList - Raw CLI arguments.
   * @param {number} index - Index of the `--file` argument.
   * @param {CliOptions} options - Mutable options being filled.
   * @returns {number} Index of the next argument.
   */
  static applyFileArgument(argumentsList, index, options) {
    const nextIndex = index + INCREMENT;
    if (nextIndex < argumentsList.length) {
      options.filePath = argumentsList[nextIndex];
    }
    return nextIndex;
  }

  /**
   * Close the current string/template frame; the closing quote is code.
   * @param {ScanState} state - Live scanner state.
   * @returns {void}
   */
  static closeFrame(state) {
    state.contextStack.pop();
    state.lastCodePos = state.pos;
    InlineCommentRewriter.advanceOneChar(state);
  }

  /**
   * Collect the spans that must never be read as comments: JSX text and regex
   * literals. Both are authoritative AST nodes; regex literals own their
   * interior (including `//`), and JSX text is literal content.
   * @param {ParsedSource} sourceFile - Parsed source file.
   * @returns {Array<readonly [number, number]>} Protected spans.
   */
  static collectProtectedRanges(sourceFile) {
    /** @type {Array<readonly [number, number]>} */
    const ranges = [];
    InlineCommentRewriter.walkProtectedNodes(sourceFile, ranges);
    ranges.sort(InlineCommentRewriter.compareByStart);
    return ranges;
  }

  /**
   * Find the index just before the newline that ends a line comment.
   * @param {string} text - Source text containing the comment.
   * @param {number} start - Comment start index.
   * @returns {number} Index just before the terminating newline.
   */
  static commentEndOf(text, start) {
    const carriageReturn = text.indexOf("\r", start + STEP),
      lineFeed = text.indexOf(LINE_FEED, start + STEP);
    return InlineCommentRewriter.closestIndexOrEnd(lineFeed, carriageReturn, text.length);
  }

  /**
   * Pick the lesser of two found indexes, or a fallback when neither exists.
   * @param {number} left - First candidate index.
   * @param {number} right - Second candidate index.
   * @param {number} fallback - Value used when both candidates are absent.
   * @returns {number} The lesser found index, or the fallback.
   */
  static closestIndexOrEnd(left, right, fallback) {
    const candidates = [left, right].filter((index) => index !== MISSING_INDEX);
    if (candidates.length === FIRST_INDEX) {
      return fallback;
    }
    return Math.min(...candidates);
  }

  /**
   * Order source edits from right to left without mutating the caller's list.
   * @param {Readonly<Edit>} left - First edit to compare.
   * @param {Readonly<Edit>} right - Second edit to compare.
   * @returns {number} Positive when the left edit must run first.
   */
  static compareEditPositions(left, right) {
    return right.pos - left.pos;
  }

  /**
   * Compare two protected ranges by their start positions.
   * @param {readonly [number, number]} left - First range to compare.
   * @param {readonly [number, number]} right - Second range to compare.
   * @returns {number} Difference of the two start positions.
   */
  static compareByStart(left, right) {
    return left.at(FIRST_INDEX) - right.at(FIRST_INDEX);
  }

  /**
   * Create the live scanner state for a source text.
   * @param {string} text - Source text to scan.
   * @param {ReadonlyArray<readonly [number, number]>} protectedRanges - Protected spans.
   * @returns {ScanState} Fresh scanner state.
   */
  static createScanState(text, protectedRanges) {
    return {
      contextStack: [],
      incrementedLines: [FIRST_INDEX],
      lastCodePos: MISSING_INDEX,
      leftAlone: [],
      line: FIRST_INDEX,
      moved: [],
      pos: FIRST_INDEX,
      protectedIndex: FIRST_INDEX,
      protectedRanges,
      text,
    };
  }

  /**
   * Find the index where the comment deletion should start.
   * @param {string} text - Source text containing the comment.
   * @param {number} start - Comment start index.
   * @returns {number} Deletion start index for the comment.
   */
  static deletionStartAt(text, start) {
    const lineStart = InlineCommentRewriter.lineStartAt(text, start);
    let deleteStart = start;
    while (
      deleteStart > lineStart &&
      InlineCommentRewriter.isIndentChar(text[deleteStart - INCREMENT])
    ) {
      deleteStart -= INCREMENT;
    }
    return deleteStart;
  }

  /**
   * Build the two edits for one comment: an insert above the line and a
   * deletion of the comment (with its preceding whitespace).
   * @param {Readonly<LineComment>} comment - Comment to move.
   * @param {string} text - Source text containing the comment.
   * @param {string} eol - Line terminator used by the file.
   * @returns {Edit[]} The insert edit and the delete edit.
   */
  static editsForComment(comment, text, eol) {
    const deleteStart = InlineCommentRewriter.deletionStartAt(text, comment.start),
      indent = InlineCommentRewriter.indentOf(text, InlineCommentRewriter.lineStartAt(text, comment.start), comment.start),
      lineStart = InlineCommentRewriter.lineStartAt(text, comment.start);
    return [
      { insert: indent + text.slice(comment.start, comment.end) + eol, pos: lineStart },
      { delEnd: comment.end, pos: deleteStart },
    ];
  }

  /**
   * Pick the line terminator used by a source text.
   * @param {string} text - Source text to inspect.
   * @returns {string} Either a CRLF or an LF terminator.
   */
  static eolOf(text) {
    if (text.includes("\r\n")) {
      return "\r\n";
    }
    return LINE_FEED;
  }

  /**
   * Grow one level of `${...}` or JSX expression nesting.
   * @param {ScanState} state - Live scanner state.
   * @returns {void}
   */
  static growExpression(state) {
    state.contextStack.at(LAST_INDEX).depth += INCREMENT;
    InlineCommentRewriter.recordCodeChar(state);
  }

  /**
   * Whether code appears before the comment on the same line.
   * @param {ScanState} state - Live scanner state.
   * @returns {boolean} True when the line has code before the comment.
   */
  static hasCodeBeforeOnLine(state) {
    return (
      state.lastCodePos !== MISSING_INDEX &&
      state.lastCodePos >= state.incrementedLines[state.line]
    );
  }

  /**
   * Compute the leading whitespace of a line.
   * @param {string} text - Source text containing the line.
   * @param {number} start - Start index of the line.
   * @param {number} end - End index of the line.
   * @returns {string} The leading spaces or tabs.
   */
  static indentOf(text, start, end) {
    let indentEnd = start;
    while (indentEnd < end && InlineCommentRewriter.isIndentChar(text[indentEnd])) {
      indentEnd += INCREMENT;
    }
    return text.slice(start, indentEnd);
  }

  /**
   * Whether a character is a space or a tab.
   * @param {string} char - Character to inspect.
   * @returns {boolean} True for spaces and tabs.
   */
  static isIndentChar(char) {
    return char === " " || char === "\t";
  }

  /**
   * Whether the scanner currently sits inside a protected range.
   * @param {ScanState} state - Live scanner state.
   * @returns {boolean} True when the position is inside a protected span.
   */
  static isInsideProtectedRange(state) {
    const range = state.protectedRanges.at(state.protectedIndex);
    return range !== undefined && state.pos >= range.at(FIRST_INDEX);
  }

  /**
   * Compute the start index of the line that contains a position.
   * @param {string} text - Source text containing the line.
   * @param {number} position - Position inside the line.
   * @returns {number} Start index of the line.
   */
  static lineStartAt(text, position) {
    return text.lastIndexOf(LINE_FEED, position - INCREMENT) + INCREMENT;
  }

  /**
   * Main CLI entry: parse arguments, transform the file, apply or report.
   * @returns {Promise<void>} Resolves when the CLI run completes.
   */
  async main() {
    const options = InlineCommentRewriter.parseCliArguments(process.argv.slice(STEP));
    if (options.help) {
      InlineCommentRewriter.printUsage();
      return;
    }
    if (options.filePath === EMPTY_STRING) {
      InlineCommentRewriter.printUsage();
      process.exitCode = FAILURE_EXIT_CODE;
      return;
    }
    await InlineCommentRewriter.processFile(options);
  }

  /**
   * Close the string frame when the closing quote is reached.
   * @param {ScanState} state - Live scanner state.
   * @returns {void}
   */
  static maybeCloseStringFrame(state) {
    const frame = state.contextStack.at(LAST_INDEX);
    if (frame !== undefined && state.text[state.pos] === frame.quote) {
      InlineCommentRewriter.closeFrame(state);
      return;
    }
    InlineCommentRewriter.advanceOneChar(state);
  }

  /**
   * End a block comment when the star-slash sequence is reached.
   * @param {ScanState} state - Live scanner state.
   * @returns {void}
   */
  static maybeEndBlockComment(state) {
    if (state.text[state.pos + INCREMENT] === "/") {
      state.contextStack.pop();
      state.pos += STEP;
      return;
    }
    InlineCommentRewriter.advanceOneChar(state);
  }

  /**
   * Open a `${...}` expression frame when the template enters one.
   * @param {ScanState} state - Live scanner state.
   * @returns {void}
   */
  static maybeOpenExpression(state) {
    const char = state.text[state.pos];
    if (char === "$" && state.text[state.pos + INCREMENT] === "{") {
      state.contextStack.push({ depth: INCREMENT, kind: "expr" });
      state.lastCodePos = state.pos;
      state.pos += STEP;
      return;
    }
    InlineCommentRewriter.advanceOneChar(state);
  }

  /**
   * Record a newline at the given position.
   * @param {ScanState} state - Live scanner state.
   * @param {number} newlinePosition - Position of the newline character.
   * @returns {void}
   */
  static onNewlineAt(state, newlinePosition) {
    state.line += INCREMENT;
    state.incrementedLines.push(newlinePosition + INCREMENT);
    state.lastCodePos = MISSING_INDEX;
  }

  /**
   * Open a `'...'` or `"..."` string frame.
   * @param {ScanState} state - Live scanner state.
   * @returns {void}
   */
  static openStringFrame(state) {
    state.contextStack.push({ kind: "string", quote: state.text[state.pos] });
    InlineCommentRewriter.advanceOneChar(state);
  }

  /**
   * Open a backtick template frame.
   * @param {ScanState} state - Live scanner state.
   * @returns {void}
   */
  static openTemplateFrame(state) {
    state.contextStack.push({ kind: "template" });
    InlineCommentRewriter.advanceOneChar(state);
  }

  /**
   * Parse CLI arguments into an options object.
   * @param {readonly string[]} argumentsList - Raw CLI arguments.
   * @returns {CliOptions} Parsed options.
   */
  static parseCliArguments(argumentsList) {
    const options = { dry: false, filePath: EMPTY_STRING, help: false };
    let index = FIRST_INDEX;
    while (index < argumentsList.length) {
      index = InlineCommentRewriter.applyCliArgument(argumentsList, index, options);
    }
    return options;
  }

  /**
   * Count parse diagnostics for a source text.
   * @param {string} sourceText - Source text to parse.
   * @param {string} filePath - Path used for script-kind detection.
   * @returns {number} Number of parse diagnostics.
   */
  static parseErrorCount(sourceText, filePath) {
    return InlineCommentRewriter.parseFile(sourceText, filePath).parseDiagnostics.length;
  }

  /**
   * Parse a source text with the script kind matching the file extension.
   * @param {string} sourceText - Source text to parse.
   * @param {string} filePath - Path used for script-kind detection.
   * @returns {ParsedSource} Parsed source file.
   */
  static parseFile(sourceText, filePath) {
    return ts.createSourceFile(
      filePath,
      sourceText,
      ts.ScriptTarget.Latest,
      false,
      InlineCommentRewriter.scriptKindOf(filePath),
    );
  }

  /**
   * Build an unchanged result from a scan.
   * @param {string} sourceText - Source text to keep.
   * @param {ScanResult} scanned - Scan outcome.
   * @returns {TransformResult} Unchanged transform result.
   */
  static passThrough(sourceText, scanned) {
    return {
      changed: false,
      leftAlone: scanned.leftAlone,
      moved: scanned.moved,
      text: sourceText,
    };
  }

  /**
   * Print the outcome of a real (non-dry) run.
   * @param {{ changed: boolean, reverted?: true }} result - Transform result.
   * @param {string} filePath - Path of the processed file.
   * @returns {void}
   */
  static printApplyReport(result, filePath) {
    if (result.reverted === true) {
      console.log(`Parse-check veto; left ${filePath} untouched`);
      return;
    }
    if (result.changed) {
      console.log(`Moved inline comments in ${filePath}`);
      return;
    }
    console.log(`No inline comments in ${filePath}`);
  }

  /**
   * Print a dry-run report with resolved and left-alone counts.
   * @param {string} source - Original source text (for examples).
   * @param {TransformResult} result - Transform result.
   * @param {string} filePath - Path of the inspected file.
   * @returns {void}
   */
  static printDryReport(source, result, filePath) {
    console.log(`Resolved inline comments: ${result.moved.length} in ${filePath}`);
    for (const comment of result.moved) {
      const example = source.slice(comment.start).split(LINE_FEED).at(FIRST_INDEX);
      console.log(`  line ${comment.line}: ${example}`);
    }
    if (result.leftAlone.length > FIRST_INDEX) {
      console.log(`Comment-only lines left alone: ${result.leftAlone.length}`);
    }
    if (result.reverted === true) {
      console.log("Parse-check veto: no changes would be applied");
    }
  }

  /**
   * Print the CLI usage text.
   * @returns {void}
   */
  static printUsage() {
    console.log("Usage: node scripts/transformations/no-inline-comments.mjs --file <path> [--dry]");
  }

  /**
   * Read, transform and apply or report for one file.
   * @param {CliOptions} options - Parsed CLI options.
   * @returns {Promise<void>} Resolves when processing completes.
   */
  static async processFile(options) {
    const source = await readFile(options.filePath, "utf8");
    if (options.dry) {
      InlineCommentRewriter.printDryReport(
        source,
        InlineCommentRewriter.runTransform(source, options.filePath),
        options.filePath,
      );
      return;
    }
    await InlineCommentRewriter.writeResult(
      InlineCommentRewriter.runTransform(source, options.filePath),
      options.filePath,
    );
  }

  /**
   * Mark the current position as code, then advance.
   * @param {ScanState} state - Live scanner state.
   * @returns {void}
   */
  static recordCodeChar(state) {
    state.lastCodePos = state.pos;
    InlineCommentRewriter.advanceOneChar(state);
  }

  /**
   * Main entry point: move trailing line comments above their statements.
   * @param {string} sourceText - Source text to transform.
   * @param {string} filePath - Path used for script-kind detection.
   * @returns {TransformResult} Transform outcome.
   */
  static runTransform(sourceText, filePath) {
    const scanned = InlineCommentRewriter.scanSource(sourceText, filePath);
    if (scanned.moved.length === FIRST_INDEX) {
      return InlineCommentRewriter.passThrough(sourceText, scanned);
    }
    return InlineCommentRewriter.finishTransform(sourceText, filePath, scanned);
  }

  /**
   * Finish a transform after edits were built, verifying the result parses.
   * @param {string} sourceText - Original source text.
   * @param {string} filePath - Path used for script-kind detection.
   * @param {ScanResult} scanned - Scan outcome.
   * @returns {TransformResult} Verified transform result.
   */
  static finishTransform(sourceText, filePath, scanned) {
    const output = InlineCommentRewriter.applyEdits(
      sourceText,
      scanned.moved,
      InlineCommentRewriter.eolOf(sourceText),
    );
    if (output === sourceText) {
      return InlineCommentRewriter.passThrough(sourceText, scanned);
    }
    return InlineCommentRewriter.verifyParsable(output, sourceText, filePath, scanned);
  }

  /**
   * Scan the whole source once, tracking string/template/block-comment state
   * across lines and skipping AST-protected ranges.
   * @param {string} text - Source text to scan.
   * @param {ReadonlyArray<readonly [number, number]>} protectedRanges - Protected spans.
   * @returns {ScanResult} Moved comments and comment-only lines.
   */
  static scanInlineComments(text, protectedRanges) {
    const state = InlineCommentRewriter.createScanState(text, protectedRanges);
    while (state.pos < text.length) {
      InlineCommentRewriter.stepScan(state);
    }
    return { leftAlone: state.leftAlone, moved: state.moved };
  }

  /**
   * Parse and scan a source text in one step.
   * @param {string} sourceText - Source text to transform.
   * @param {string} filePath - Path used for script-kind detection.
   * @returns {ScanResult} Moved comments and comment-only lines.
   */
  static scanSource(sourceText, filePath) {
    const sourceFile = InlineCommentRewriter.parseFile(sourceText, filePath);
    return InlineCommentRewriter.scanInlineComments(
      sourceText,
      InlineCommentRewriter.collectProtectedRanges(sourceFile),
    );
  }

  /**
   * Pick the TypeScript script kind for a file path.
   * @param {string} filePath - Path to inspect.
   * @returns {number} TypeScript script kind.
   */
  static scriptKindOf(filePath) {
    if (filePath.endsWith(".tsx") || filePath.endsWith(".jsx")) {
      return ts.ScriptKind.TSX;
    }
    if (filePath.endsWith(".js")) {
      return ts.ScriptKind.JS;
    }
    return ts.ScriptKind.TS;
  }

  /**
   * Shrink one level of `${...}` or JSX expression nesting.
   * @param {ScanState} state - Live scanner state.
   * @returns {void}
   */
  static shrinkExpression(state) {
    const frame = state.contextStack.at(LAST_INDEX);
    frame.depth -= INCREMENT;
    if (frame.depth > FIRST_INDEX) {
      InlineCommentRewriter.recordCodeChar(state);
      return;
    }
    state.contextStack.pop();
    InlineCommentRewriter.advanceOneChar(state);
  }

  /**
   * Skip a backslash escape; a continued line keeps its bookkeeping.
   * @param {ScanState} state - Live scanner state.
   * @returns {void}
   */
  static skipEscapedCharacter(state) {
    if (state.text[state.pos + INCREMENT] === LINE_FEED) {
      InlineCommentRewriter.onNewlineAt(state, state.pos + INCREMENT);
    }
    state.pos += STEP;
  }

  /**
   * Skip the current protected range, keeping line bookkeeping intact.
   * @param {ScanState} state - Live scanner state.
   * @returns {void}
   */
  static skipProtectedRange(state) {
    const range = state.protectedRanges.at(state.protectedIndex);
    while (state.pos < range.at(INCREMENT)) {
      InlineCommentRewriter.advanceOneChar(state);
    }
    state.protectedIndex += INCREMENT;
  }

  /**
   * Handle a character inside a block comment.
   * @param {ScanState} state - Live scanner state.
   * @returns {void}
   */
  static stepBlockComment(state) {
    const stepper = InlineCommentRewriter.BlockCommentSteppers[state.text[state.pos]];
    if (stepper !== undefined) {
      stepper(state);
      return;
    }
    InlineCommentRewriter.advanceOneChar(state);
  }

  /**
   * Dispatch one scan step by the current context kind.
   * @param {ScanState} state - Live scanner state.
   * @returns {void}
   */
  static stepByContext(state) {
    const frame = state.contextStack.at(LAST_INDEX),
      kind = InlineCommentRewriter.contextKindOf(frame),
      stepper = InlineCommentRewriter.ContextSteppers[kind];
    if (stepper !== undefined) {
      stepper(state);
      return;
    }
    InlineCommentRewriter.stepBlockComment(state);
  }

  /**
   * Handle one character inside code or a `${...}`/JSX expression.
   * @param {ScanState} state - Live scanner state.
   * @returns {void}
   */
  static stepCode(state) {
    const stepper = InlineCommentRewriter.CodeSteppers[state.text[state.pos]];
    if (stepper !== undefined) {
      stepper(state);
      return;
    }
    InlineCommentRewriter.stepCodeDefault(state);
  }

  /**
   * Handle a character that is not a string/template/slash special in code.
   * @param {ScanState} state - Live scanner state.
   * @returns {void}
   */
  static stepCodeDefault(state) {
    if (InlineCommentRewriter.isWhitespaceChar(state.text[state.pos])) {
      InlineCommentRewriter.advanceOneChar(state);
      return;
    }
    if (InlineCommentRewriter.isExpressionContext(state)) {
      InlineCommentRewriter.stepCodeInExpression(state);
      return;
    }
    InlineCommentRewriter.recordCodeChar(state);
  }

  /**
   * Handle code characters inside a `${...}` or JSX expression.
   * @param {ScanState} state - Live scanner state.
   * @returns {void}
   */
  static stepCodeInExpression(state) {
    const char = state.text[state.pos];
    if (char === "{") {
      InlineCommentRewriter.growExpression(state);
      return;
    }
    if (char === "}") {
      InlineCommentRewriter.shrinkExpression(state);
      return;
    }
    InlineCommentRewriter.recordCodeChar(state);
  }

  /**
   * Whether a character is ignorable whitespace.
   * @param {string} char - Character to inspect.
   * @returns {boolean} True for spaces, tabs and carriage returns.
   */
  static isWhitespaceChar(char) {
    return char === " " || char === "\t" || char === "\r";
  }

  /**
   * Whether the current scanner frame is an expression frame.
   * @param {ScanState} state - Live scanner state.
   * @returns {boolean} True when inside a `${...}` or JSX expression.
   */
  static isExpressionContext(state) {
    return state.contextStack.at(LAST_INDEX)?.kind === "expr";
  }

  /**
   * Handle a line comment found in code position.
   * @param {ScanState} state - Live scanner state.
   * @returns {void}
   */
  static stepLineComment(state) {
    const end = InlineCommentRewriter.commentEndOf(state.text, state.pos),
      start = state.pos;
    if (InlineCommentRewriter.hasCodeBeforeOnLine(state)) {
      state.moved.push({ end, line: state.line + INCREMENT, start });
    } else {
      state.leftAlone.push({ line: state.line + INCREMENT, start });
    }
    while (state.pos < end) {
      InlineCommentRewriter.advanceOneChar(state);
    }
  }

  /**
   * Handle one scan step: skip protected ranges, then dispatch.
   * @param {ScanState} state - Live scanner state.
   * @returns {void}
   */
  static stepScan(state) {
    if (InlineCommentRewriter.isInsideProtectedRange(state)) {
      InlineCommentRewriter.skipProtectedRange(state);
      return;
    }
    if (state.text[state.pos] === LINE_FEED) {
      InlineCommentRewriter.advanceOneChar(state);
      return;
    }
    InlineCommentRewriter.stepByContext(state);
  }

  /**
   * Handle a slash: line comment, block comment, or divide/regex start.
   * @param {ScanState} state - Live scanner state.
   * @returns {void}
   */
  static stepSlash(state) {
    const next = state.text[state.pos + INCREMENT];
    if (next === "/") {
      InlineCommentRewriter.stepLineComment(state);
      return;
    }
    if (next === "*") {
      state.contextStack.push({ kind: "blockComment" });
      state.pos += STEP;
      return;
    }
    InlineCommentRewriter.recordCodeChar(state);
  }

  /**
   * Handle one character inside a `'...'` or `"..."` string.
   * @param {ScanState} state - Live scanner state.
   * @returns {void}
   */
  static stepString(state) {
    const stepper = InlineCommentRewriter.StringSteppers[state.text[state.pos]];
    if (stepper !== undefined) {
      stepper(state);
      return;
    }
    InlineCommentRewriter.maybeCloseStringFrame(state);
  }

  /**
   * Handle one character inside a backtick template.
   * @param {ScanState} state - Live scanner state.
   * @returns {void}
   */
  static stepTemplate(state) {
    const stepper = InlineCommentRewriter.TemplateSteppers[state.text[state.pos]];
    if (stepper !== undefined) {
      stepper(state);
      return;
    }
    InlineCommentRewriter.advanceOneChar(state);
  }

  /**
   * Verify the rewritten text still parses, then return the final result.
   * @param {string} output - Rewritten source text.
   * @param {string} sourceText - Original source text.
   * @param {string} filePath - Path used for script-kind detection.
   * @param {ScanResult} scanned - Scan outcome.
   * @returns {TransformResult} Verified transform result.
   */
  static verifyParsable(output, sourceText, filePath, scanned) {
    if (
      InlineCommentRewriter.parseErrorCount(output, filePath) >
      InlineCommentRewriter.parseErrorCount(sourceText, filePath)
    ) {
      return {
        changed: false,
        leftAlone: scanned.leftAlone,
        moved: scanned.moved,
        reverted: true,
        text: sourceText,
      };
    }
    return { changed: true, leftAlone: scanned.leftAlone, moved: scanned.moved, text: output };
  }

  /**
   * Walk the tree collecting protected ranges.
   * @param {ParsedNode} node - Node to inspect.
   * @param {Array<readonly [number, number]>} ranges - Protected ranges being filled.
   * @returns {void}
   */
  static walkProtectedNodes(node, ranges) {
    if (
      node.kind === InlineCommentRewriter.JSX_TEXT_KIND ||
      node.kind === InlineCommentRewriter.REGEX_LITERAL_KIND
    ) {
      ranges.push([node.pos, node.end]);
      return;
    }
    node.forEachChild((child) => {
      InlineCommentRewriter.walkProtectedNodes(child, ranges);
    });
  }

  /**
   * Write the transformed text to disk when it changed.
   * @param {TransformResult} result - Transform result.
   * @param {string} filePath - Path of the file to write.
   * @returns {Promise<void>} Resolves when writing completes.
   */
  static async writeResult(result, filePath) {
    if (result.changed) {
      await writeFile(filePath, result.text);
    }
    InlineCommentRewriter.printApplyReport(result, filePath);
  }

  /**
   * Get the scanner context-kind string for a frame.
   * @param {Frame | undefined} frame - Current scanner frame.
   * @returns {string} Context kind, or the code kind when no frame exists.
   */
  static contextKindOf(frame) {
    if (frame === undefined) {
      return "code";
    }
    return frame.kind;
  }
}

/** @typedef {Readonly<{ kind: string; quote?: string }>} Frame */
/** @typedef {Readonly<{ end: number; line: number; start: number }>} LineComment */
/** @typedef {Readonly<{ line: number; start: number }>} CommentOnlyLine */
/** @typedef {{ delEnd?: number; insert?: string; pos: number }} Edit */
/** @typedef {Readonly<{ parseDiagnostics: readonly unknown[] }>} ParsedSource */
/** @typedef {Readonly<{ kind: number; pos: number; end: number; forEachChild: (callback: (child: ParsedNode) => void) => void }>} ParsedNode */
/**
 * @typedef {{
 *   contextStack: Frame[],
 *   incrementedLines: number[],
 *   leftAlone: CommentOnlyLine[],
 *   line: number,
 *   lastCodePos: number,
 *   moved: LineComment[],
 *   pos: number,
 *   protectedIndex: number,
 *   protectedRanges: ReadonlyArray<readonly [number, number]>,
 *   text: string,
 * }} ScanState
 */
/** @typedef {{ dry: boolean; filePath: string; help: boolean }} CliOptions */
/** @typedef {Readonly<{ changed: boolean; leftAlone: CommentOnlyLine[]; moved: LineComment[]; reverted?: true; text: string }>} TransformResult */
/** @typedef {Readonly<{ leftAlone: CommentOnlyLine[]; moved: LineComment[] }>} ScanResult */

/**
 * Exportable transform entry point.
 * @param {string} sourceText - Source text to transform.
 * @param {string} filePath - Path used for script-kind detection.
 * @returns {TransformResult} Transform outcome.
 */
if (import.meta.main === true) {
  await new InlineCommentRewriter().main().catch((error) => {
    if (error instanceof Error) {
      console.error(error.message);
    } else {
      console.error(String(error));
    }
    process.exitCode = ERROR_EXIT_CODE;
  });
}

export const runTransform = (sourceText, filePath) => InlineCommentRewriter.runTransform(sourceText, filePath);
