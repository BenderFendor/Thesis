import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const ARBITRARY_VALUE_PATTERNS = [
  /(^|\s)(?:w|h|min-w|min-h|max-w|max-h|p|px|py|pt|pr|pb|pl|m|mx|my|mt|mr|mb|ml|gap|inset|top|right|bottom|left|z|text|bg|border|shadow|tracking|leading|rounded|grid-cols|grid-rows)-\[[^\]]+\]/,
  /(^|\s)bg-\[[^\]]+\]/,
  /(^|\s)from-\[[^\]]+\]/,
  /(^|\s)via-\[[^\]]+\]/,
  /(^|\s)to-\[[^\]]+\]/,
  /(^|\s)hover:shadow-\[[^\]]+\]/,
  /(^|\s)md:grid-cols-\[[^\]]+\]/,
];

const classAttributePattern = /className\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

const noArbitraryValueRule = {
  meta: {
    type: "problem",
    docs: {
      description: "Disallow arbitrary Tailwind values in className strings",
    },
    schema: [],
    messages: {
      arbitraryValue:
        "Avoid arbitrary Tailwind values in className strings. Use existing tokens or semantic utilities instead.",
    },
  },
  create(context) {
    const sourceCode = context.sourceCode;

    return {
      Program(node) {
        const text = sourceCode.getText(node);
        let match = classAttributePattern.exec(text);

        while (match) {
          const classValue = match[1] ?? match[2] ?? "";
          const hasArbitraryValue = ARBITRARY_VALUE_PATTERNS.some((pattern) =>
            pattern.test(classValue),
          );

          if (hasArbitraryValue) {
            const fullMatch = match[0];
            const quoteOffset = fullMatch.indexOf(classValue);
            const startIndex = match.index + quoteOffset;
            const endIndex = startIndex + classValue.length;

            context.report({
              loc: {
                start: sourceCode.getLocFromIndex(startIndex),
                end: sourceCode.getLocFromIndex(endIndex),
              },
              messageId: "arbitraryValue",
            });
          }

          match = classAttributePattern.exec(text);
        }
      },
    };
  },
};

export default [
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    plugins: {
      tailwindcss: {
        rules: {
          "no-arbitrary-value": noArbitraryValueRule,
        },
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
  {
    files: [
      "app/search/page.tsx",
      "components/article-detail-modal.tsx",
      "components/chat-sidebar.tsx",
      "components/feed-view.tsx",
      "components/grid-view.tsx",
    ],
    rules: {
      "tailwindcss/no-arbitrary-value": "error",
    },
  },
];
