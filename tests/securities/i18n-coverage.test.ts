import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { translateUi } from "../../src/lib/i18n/translate";

test("authored static JSX labels have a translation or an explicit language/brand exception", () => {
  const missing: string[] = [];
  const intentional = new Set(["YouAnalyst", "YouAnalyst.", "SEC EDGAR", "CIK", "English", "EN", "AI", "USD", "UTC", "Pro", "round(", "* tanh(return /", "&mdash;", "&middot;"]);
  function scan(directory: string) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) { scan(file); continue; }
      if (!file.endsWith(".tsx") || /image|share-image/.test(file)) continue;
      const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      function visit(node: ts.Node) {
        if (ts.isJsxSelfClosingElement(node)) {
          let parent: ts.Node | undefined = node.parent;
          while (parent && !ts.isTemplateSpan(parent)) parent = parent.parent;
          if (parent) missing.push(`${file}: JSX must not be interpolated into a string template`);
        }
        if (ts.isJsxText(node)) {
          const value = node.text.replace(/\s+/g, " ").trim();
          if (/[a-zA-Z]{2}/.test(value) && !/[\u4e00-\u9fff]/.test(value) && !intentional.has(value)) missing.push(`${file}: ${value}`);
        }
        if (ts.isJsxAttribute(node) && node.name.getText(source) === "text" && ts.isJsxSelfClosingElement(node.parent.parent) && node.parent.parent.tagName.getText(source) === "UiText") {
          const initializer = node.initializer;
          const literal = initializer && ts.isJsxExpression(initializer) ? initializer.expression : initializer;
          if (literal && ts.isStringLiteral(literal)) {
            const value = literal.text.trim();
            if (/[A-Za-z]{2}/.test(value) && translateUi(value, "zh-CN") === translateUi(value, "en") && !intentional.has(value)) missing.push(`${file}: missing catalog entry ${value}`);
          }
        }
        ts.forEachChild(node, visit);
      }
      visit(source);
    }
  }
  scan("src/components"); scan("src/app");
  assert.deepEqual(missing, []);
});
