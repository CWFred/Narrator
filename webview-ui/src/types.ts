export interface SegmentNode {
  id: string;
  narration: string;
  highlight_lines: number[];
  highlight_range: { start: number; end: number };
  children?: SegmentNode[];
  isExpanded: boolean;
  isLoading: boolean;
}

let counter = 0;
export function generateId(): string {
  return `seg-${Date.now()}-${counter++}`;
}

export function findNodeById(tree: SegmentNode[], id: string): SegmentNode | undefined {
  for (const node of tree) {
    if (node.id === id) return node;
    if (node.children) {
      const found = findNodeById(node.children, id);
      if (found) return found;
    }
  }
  return undefined;
}

export function updateNodeById(tree: SegmentNode[], id: string, updater: (node: SegmentNode) => SegmentNode): SegmentNode[] {
  return tree.map((node) => {
    if (node.id === id) return updater(node);
    if (node.children) {
      return { ...node, children: updateNodeById(node.children, id, updater) };
    }
    return node;
  });
}

export function segmentsToNodes(segments: Array<{ narration: string; highlight_lines: number[]; highlight_range: { start: number; end: number } }>): SegmentNode[] {
  return segments.map((seg) => ({
    id: generateId(),
    narration: seg.narration,
    highlight_lines: seg.highlight_lines,
    highlight_range: seg.highlight_range,
    isExpanded: false,
    isLoading: false,
  }));
}

export function isExpandable(node: SegmentNode): boolean {
  const range = node.highlight_range;
  if (!range || range.start <= 0 || range.end <= 0) return false;
  return range.end - range.start + 1 > 3;
}

export function flattenVisibleNodes(tree: SegmentNode[]): SegmentNode[] {
  const result: SegmentNode[] = [];
  for (const node of tree) {
    result.push(node);
    if (node.isExpanded && node.children) {
      result.push(...flattenVisibleNodes(node.children));
    }
  }
  return result;
}
