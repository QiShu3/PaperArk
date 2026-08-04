const SKIP_TYPES = new Set(['code', 'inlineCode']);

export function remarkLatexDelimiters() {
  return (tree: any) => {
    function walk(node: any) {
      if (node.type === 'text' && node.value) {
        node.value = node.value.replace(/\\\[([\s\S]*?)\\\]/g, '$$$$$$1$$$$');
        node.value = node.value.replace(/\\\(([\s\S]*?)\\\)/g, '$$1$');
      }
      if (node.children && !SKIP_TYPES.has(node.type)) {
        for (const child of node.children) {
          walk(child);
        }
      }
    }
    walk(tree);
  };
}
