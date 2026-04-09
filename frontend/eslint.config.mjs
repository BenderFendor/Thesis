import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import reactHooks from "eslint-plugin-react-hooks";

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
const EFFECT_HOOK_NAMES = new Set([
  "useCallback",
  "useEffect",
  "useImperativeHandle",
  "useInsertionEffect",
  "useLayoutEffect",
  "useMemo",
]);

const STABLE_HOOK_RESULT_NAMES = new Set([
  "useCallback",
  "useActionState",
  "useContext",
  "useDebugValue",
  "useDeferredValue",
  "useId",
  "useMemo",
  "useOptimistic",
  "useQueryClient",
  "useReducer",
  "useRef",
  "useState",
  "useSyncExternalStore",
  "useTransition",
]);

function getCalleeName(callee) {
  if (callee.type === "Identifier") {
    return callee.name;
  }

  if (
    callee.type === "MemberExpression" &&
    !callee.computed &&
    callee.property.type === "Identifier"
  ) {
    return callee.property.name;
  }

  return null;
}

function findVariable(scope, name) {
  let currentScope = scope;

  while (currentScope) {
    const variable = currentScope.variables.find(
      (candidate) => candidate.name === name,
    );

    if (variable) {
      return variable;
    }

    currentScope = currentScope.upper;
  }

  return null;
}

function getJsxElementName(nameNode) {
  if (!nameNode) {
    return null;
  }

  if (nameNode.type === "JSXIdentifier") {
    return nameNode.name;
  }

  if (nameNode.type === "JSXMemberExpression") {
    return nameNode.property.name;
  }

  return null;
}

function hasDescendantElement(node, targetNames) {
  if (!node || typeof node !== "object") {
    return false;
  }

  if (node.type === "JSXElement") {
    const name = getJsxElementName(node.openingElement?.name);
    if (name && targetNames.has(name)) {
      return true;
    }

    return node.children.some((child) => hasDescendantElement(child, targetNames));
  }

  if (node.type === "JSXFragment") {
    return node.children.some((child) => hasDescendantElement(child, targetNames));
  }

  if (node.type === "JSXExpressionContainer") {
    return hasDescendantElement(node.expression, targetNames);
  }

  if (node.type === "ConditionalExpression") {
    return (
      hasDescendantElement(node.consequent, targetNames) ||
      hasDescendantElement(node.alternate, targetNames)
    );
  }

  if (node.type === "LogicalExpression") {
    return hasDescendantElement(node.right, targetNames);
  }

  if (node.type === "ArrayExpression") {
    return node.elements.some((child) => hasDescendantElement(child, targetNames));
  }

  return false;
}

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

const noHookObjectDependenciesRule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow using entire custom hook result objects in dependency arrays",
    },
    schema: [],
    messages: {
      hookObjectDependency:
        "Avoid using the entire result of custom hook '{{hookName}}' in a dependency array. Destructure the specific field you need instead.",
    },
  },
  create(context) {
    const sourceCode = context.sourceCode;

    return {
      CallExpression(node) {
        const hookName = getCalleeName(node.callee);
        if (!hookName || !EFFECT_HOOK_NAMES.has(hookName)) {
          return;
        }

        const dependencyArray = node.arguments[1];
        if (!dependencyArray || dependencyArray.type !== "ArrayExpression") {
          return;
        }

        for (const dependency of dependencyArray.elements) {
          if (!dependency || dependency.type !== "Identifier") {
            continue;
          }

          const scope = sourceCode.getScope?.(dependency);
          if (!scope) {
            continue;
          }

          const variable = findVariable(scope, dependency.name);
          const definition = variable?.defs?.[0];
          const declarator = definition?.node;
          if (
            !declarator ||
            declarator.type !== "VariableDeclarator" ||
            declarator.id.type !== "Identifier"
          ) {
            continue;
          }

          const init = declarator.init;

          if (!init || init.type !== "CallExpression") {
            continue;
          }

          const dependencyHookName = getCalleeName(init.callee);
          if (
            !dependencyHookName ||
            !/^use[A-Z0-9]/.test(dependencyHookName) ||
            STABLE_HOOK_RESULT_NAMES.has(dependencyHookName)
          ) {
            continue;
          }

          context.report({
            node: dependency,
            messageId: "hookObjectDependency",
            data: {
              hookName: dependencyHookName,
            },
          });
        }
      },
    };
  },
};

const noNestedButtonContentRule = {
  meta: {
    type: "problem",
    docs: {
      description: "Disallow rendering button-like elements inside button-like ancestors",
    },
    schema: [],
    messages: {
      nestedButton:
        "Do not nest '{{childName}}' inside '{{ancestorName}}'. Use a non-button container for the outer interactive surface.",
    },
  },
  create(context) {
    const buttonNames = new Set(["button", "Button"]);

    return {
      JSXElement(node) {
        const childName = getJsxElementName(node.openingElement.name);
        if (!childName || !buttonNames.has(childName)) {
          return;
        }

        let parent = node.parent;
        while (parent) {
          if (parent.type === "JSXElement") {
            const ancestorName = getJsxElementName(parent.openingElement.name);
            if (ancestorName && buttonNames.has(ancestorName)) {
              context.report({
                node: node.openingElement,
                messageId: "nestedButton",
                data: { childName, ancestorName },
              });
              return;
            }
          }
          parent = parent.parent;
        }
      },
    };
  },
};

const requireDialogTitleRule = {
  meta: {
    type: "problem",
    docs: {
      description: "Require DialogContent trees to include a DialogTitle descendant",
    },
    schema: [],
    messages: {
      missingDialogTitle:
        "DialogContent must include a DialogTitle descendant so the dialog is accessible to screen readers.",
    },
  },
  create(context) {
    const titleNames = new Set(["DialogTitle"]);

    return {
      JSXElement(node) {
        if (getJsxElementName(node.openingElement.name) !== "DialogContent") {
          return;
        }

        if (node.children.some((child) => hasDescendantElement(child, titleNames))) {
          return;
        }

        context.report({
          node: node.openingElement,
          messageId: "missingDialogTitle",
        });
      },
    };
  },
};

const config = [
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    plugins: {
      "react-hooks": reactHooks,
      tailwindcss: {
        rules: {
          "no-arbitrary-value": noArbitraryValueRule,
        },
      },
      thesis: {
        rules: {
          "no-hook-object-dependencies": noHookObjectDependenciesRule,
          "no-nested-button-content": noNestedButtonContentRule,
          "require-dialog-title": requireDialogTitleRule,
        },
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "react-hooks/set-state-in-effect": "error",
      "react-hooks/set-state-in-render": "error",
      "thesis/no-hook-object-dependencies": "error",
      "thesis/no-nested-button-content": "error",
      "thesis/require-dialog-title": "error",
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

export default config;
