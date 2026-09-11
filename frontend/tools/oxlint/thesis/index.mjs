import { eslintCompatPlugin } from "@oxlint/plugins";

const ARBITRARY_VALUE_PATTERNS = [
  /(^|\s)(?:w|h|min-w|min-h|max-w|max-h|p|px|py|pt|pr|pb|pl|m|mx|my|mt|mr|mb|ml|gap|inset|top|right|bottom|left|z|text|bg|border|shadow|tracking|leading|rounded|grid-cols|grid-rows)-\[[^\]]+\]/,
  /(^|\s)bg-\[[^\]]+\]/,
  /(^|\s)from-\[[^\]]+\]/,
  /(^|\s)via-\[[^\]]+\]/,
  /(^|\s)to-\[[^\]]+\]/,
  /(^|\s)hover:shadow-\[[^\]]+\]/,
  /(^|\s)md:grid-cols-\[[^\]]+\]/,
];

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
  if (callee?.type === "Identifier") return callee.name;
  if (
    callee?.type === "MemberExpression" &&
    !callee.computed &&
    callee.property?.type === "Identifier"
  ) {
    return callee.property.name;
  }
  return null;
}

function getJsxElementName(nameNode) {
  if (nameNode?.type === "JSXIdentifier") return nameNode.name;
  if (nameNode?.type === "JSXMemberExpression") return nameNode.property?.name ?? null;
  return null;
}

function hasDescendantElement(node, targetNames) {
  if (!node || typeof node !== "object") return false;
  if (node.type === "JSXElement") {
    const name = getJsxElementName(node.openingElement?.name);
    return (
      (name !== null && targetNames.has(name)) ||
      node.children.some((child) => hasDescendantElement(child, targetNames))
    );
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

function findVariable(scope, name) {
  for (let current = scope; current; current = current.upper) {
    const variable = current.variables.find((candidate) => candidate.name === name);
    if (variable) return variable;
  }
  return null;
}

function isMapCallback(node) {
  return Boolean(
    node &&
      (node.type === "ArrowFunctionExpression" || node.type === "FunctionExpression") &&
      node.parent?.type === "CallExpression" &&
      node.parent.callee?.type === "MemberExpression" &&
      !node.parent.callee.computed &&
      node.parent.callee.property?.type === "Identifier" &&
      node.parent.callee.property.name === "map",
  );
}

function findEnclosingMapCallback(node) {
  for (let current = node?.parent ?? null; current; current = current.parent) {
    if (isMapCallback(current)) return current;
  }
  return null;
}

function getMapCallbackParamName(node) {
  const firstParam = node?.params?.[0];
  return firstParam?.type === "Identifier" ? firstParam.name : null;
}

function isFragileMapKeyExpression(node, callbackParamName) {
  if (
    !node ||
    node.type !== "MemberExpression" ||
    node.computed ||
    node.object?.type !== "Identifier" ||
    node.object.name !== callbackParamName ||
    node.property?.type !== "Identifier"
  ) {
    return false;
  }
  return node.property.name === "url" || (node.property.name === "id" && callbackParamName === "article");
}

const noArbitraryTailwindValue = {
  meta: {
    type: "problem",
    schema: [],
    messages: {
      arbitraryValue:
        "Avoid arbitrary Tailwind values in className strings. Use an existing token or semantic utility.",
    },
  },
  create(context) {
    return {
      JSXAttribute(node) {
        if (node.name?.type !== "JSXIdentifier" || node.name.name !== "className") return;
        if (node.value?.type !== "Literal" || typeof node.value.value !== "string") return;
        if (ARBITRARY_VALUE_PATTERNS.some((pattern) => pattern.test(node.value.value))) {
          context.report({ node: node.value, messageId: "arbitraryValue" });
        }
      },
    };
  },
};

const noHookObjectDependencies = {
  meta: {
    type: "problem",
    schema: [],
    messages: {
      hookObjectDependency:
        "Do not depend on the entire result of custom hook '{{hookName}}'. Destructure the specific stable field needed by the hook.",
    },
  },
  create(context) {
    const sourceCode = context.sourceCode;
    return {
      CallExpression(node) {
        const hookName = getCalleeName(node.callee);
        if (!hookName || !EFFECT_HOOK_NAMES.has(hookName)) return;
        const dependencies = node.arguments?.[1];
        if (dependencies?.type !== "ArrayExpression") return;

        for (const dependency of dependencies.elements) {
          if (dependency?.type !== "Identifier") continue;
          const scope = sourceCode.getScope?.(dependency);
          const definition = scope ? findVariable(scope, dependency.name)?.defs?.[0] : null;
          const declarator = definition?.node;
          if (
            declarator?.type !== "VariableDeclarator" ||
            declarator.id?.type !== "Identifier" ||
            declarator.init?.type !== "CallExpression"
          ) {
            continue;
          }
          const dependencyHookName = getCalleeName(declarator.init.callee);
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
            data: { hookName: dependencyHookName },
          });
        }
      },
    };
  },
};

const noNestedButtonContent = {
  meta: {
    type: "problem",
    schema: [],
    messages: {
      nestedButton:
        "Do not nest '{{childName}}' inside '{{ancestorName}}'. Use a non-button outer container.",
    },
  },
  create(context) {
    const buttonNames = new Set(["button", "Button"]);
    return {
      JSXElement(node) {
        const childName = getJsxElementName(node.openingElement?.name);
        if (!childName || !buttonNames.has(childName)) return;
        for (let parent = node.parent; parent; parent = parent.parent) {
          if (parent.type !== "JSXElement") continue;
          const ancestorName = getJsxElementName(parent.openingElement?.name);
          if (ancestorName && buttonNames.has(ancestorName)) {
            context.report({
              node: node.openingElement,
              messageId: "nestedButton",
              data: { childName, ancestorName },
            });
            return;
          }
        }
      },
    };
  },
};

const requireDialogTitle = {
  meta: {
    type: "problem",
    schema: [],
    messages: {
      missingDialogTitle:
        "DialogContent must contain a DialogTitle descendant for an accessible name.",
    },
  },
  create(context) {
    const titleNames = new Set(["DialogTitle"]);
    return {
      JSXElement(node) {
        if (getJsxElementName(node.openingElement?.name) !== "DialogContent") return;
        if (node.children.some((child) => hasDescendantElement(child, titleNames))) return;
        context.report({ node: node.openingElement, messageId: "missingDialogTitle" });
      },
    };
  },
};

const noFragileMapKeys = {
  meta: {
    type: "problem",
    schema: [],
    messages: {
      fragileMapKey:
        "Do not use a fragile single-field key inside .map(). Use a stable unique key, composite key, or dedupe first.",
    },
  },
  create(context) {
    return {
      JSXAttribute(node) {
        if (node.name?.type !== "JSXIdentifier" || node.name.name !== "key") return;
        const callback = findEnclosingMapCallback(node);
        const callbackParamName = getMapCallbackParamName(callback);
        if (!callbackParamName) return;
        if (
          node.value?.type === "JSXExpressionContainer" &&
          isFragileMapKeyExpression(node.value.expression, callbackParamName)
        ) {
          context.report({ node, messageId: "fragileMapKey" });
        }
      },
    };
  },
};

export default eslintCompatPlugin({
  meta: { name: "thesis" },
  rules: {
    "no-arbitrary-tailwind-value": noArbitraryTailwindValue,
    "no-fragile-map-keys": noFragileMapKeys,
    "no-hook-object-dependencies": noHookObjectDependencies,
    "no-nested-button-content": noNestedButtonContent,
    "require-dialog-title": requireDialogTitle,
  },
});
