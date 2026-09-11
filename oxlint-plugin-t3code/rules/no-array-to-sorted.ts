import { defineRule } from "@oxlint/plugins";

// Hermes, the mobile JS engine, ships toReversed and findLast but not
// toSorted. A call reaches production as a TypeError that React Native turns
// into a fatal crash, and Node-based tests never notice. Scoped in the lint
// config to the packages the mobile bundle can import.
const MISSING_ON_HERMES = new Set(["toSorted"]);

export default defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow Array.prototype methods Hermes does not implement in code the mobile app can bundle.",
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        if (node.callee.type !== "MemberExpression") return;
        if (node.callee.computed) return;
        if (node.callee.property.type !== "Identifier") return;
        const name = node.callee.property.name;
        if (!MISSING_ON_HERMES.has(name)) return;

        context.report({
          node: node.callee.property,
          message: `Array.prototype.${name} is not implemented by Hermes and crashes the mobile app. Copy and sort instead: [...items].sort(compare).`,
        });
      },
    };
  },
});
