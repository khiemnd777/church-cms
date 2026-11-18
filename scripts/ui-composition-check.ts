import ts from "typescript";

export interface CompositionIssue {
  line: number;
  message: string;
}
/** A structural gate, not a claim that syntax can decide visual hierarchy. */
export function compositionIssues(file: string, source: string): CompositionIssue[] {
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX),
    issues: CompositionIssue[] = [];
  const tag = (n: ts.Node): string =>
    ts.isJsxElement(n)
      ? n.openingElement.tagName.getText(tree)
      : ts.isJsxSelfClosingElement(n)
        ? n.tagName.getText(tree)
        : "";
  const visible = (children: ts.NodeArray<ts.JsxChild>) =>
    children.filter(
      (n) => !(ts.isJsxText(n) && !n.text.trim()) && !(ts.isJsxExpression(n) && !n.expression),
    );
  const unownedWrapper = (n: ts.Node): n is ts.JsxElement =>
    ts.isJsxElement(n) &&
    ["div", "section"].includes(tag(n)) &&
    !n.openingElement.attributes.properties.some(
      (p) => ts.isJsxAttribute(p) && p.name.getText(tree) === "className",
    );
  const branches = (n: ts.Node): ts.Node[] => {
    if (ts.isParenthesizedExpression(n)) return branches(n.expression);
    if (ts.isJsxFragment(n) || unownedWrapper(n)) return visible(n.children).flatMap(branches);
    if (ts.isJsxExpression(n)) return n.expression ? branches(n.expression) : [];
    if (ts.isConditionalExpression(n)) {
      const a = branches(n.whenTrue),
        b = branches(n.whenFalse);
      return a.length >= b.length ? a : b;
    }
    if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken)
      return branches(n.right);
    return [n];
  };
  function visit(n: ts.Node) {
    if (ts.isJsxElement(n) && tag(n) === "Card") {
      const attrs = n.openingElement.attributes.properties,
        spacing = attrs.some((p) => ts.isJsxAttribute(p) && p.name.getText(tree) === "spacing"),
        cls = attrs.find((p) => ts.isJsxAttribute(p) && p.name.getText(tree) === "className");
      const className =
        cls && ts.isJsxAttribute(cls) && cls.initializer && ts.isStringLiteral(cls.initializer)
          ? cls.initializer.text
          : "";
      // These existing source patterns own their internal layout in CSS.
      const sourceLayout = className
        .split(/\s+/)
        .some((c) => ["kpi", "program-section", "ui-auth-card"].includes(c));
      const children = visible(n.children).flatMap(branches),
        headerAndBody = children.length === 2 && tag(children[0] as ts.Node) === "SectionHeader";
      const ungroupedMap = children.some(
        (c) =>
          ts.isCallExpression(c) &&
          ts.isPropertyAccessExpression(c.expression) &&
          c.expression.name.text === "map",
      );
      const bareBody = visible(n.children).some(
        (c) => unownedWrapper(c) && visible(c.children).flatMap(branches).length > 1,
      );
      if (
        bareBody ||
        (!spacing && !sourceLayout && ((children.length > 1 && !headerAndBody) || ungroupedMap))
      )
        issues.push({
          line: tree.getLineAndCharacterOfPosition(n.getStart(tree)).line + 1,
          message:
            "Card nhiều khối cần Card spacing, Stack/ContentSection hoặc SectionHeader + một body layout; Fragment/conditional không tạo gap.",
        });
    }
    ts.forEachChild(n, visit);
  }
  visit(tree);
  return issues;
}
