interface ReadonlyDomNode {
  readonly childNodes: {
    readonly length: number
    readonly [index: number]: ReadonlyDomNode | undefined
  }
  readonly nodeType: number
  readonly parentNode: ReadonlyDomNode | null
  readonly textContent: string | null
}

interface HighlightTextNodeState {
  currentNode: ReadonlyDomNode | undefined
  nodes: ReadonlyDomNode[]
  walker: TreeWalker
}

const ELEMENT_NODE_TYPE = 1,
 EMPTY_TEXT_LENGTH = 0,
 FIRST_INDEX = 0,
 INDEX_INCREMENT = 1,
 INVALID_OFFSET = -1,

 findTextNodes = <TRoot extends Node,>(root: Readonly<TRoot>): ReadonlyDomNode[] => {
  const state: HighlightTextNodeState = {
    currentNode: undefined,
    nodes: [],
    walker: document.createTreeWalker(root, NodeFilter.SHOW_TEXT),
  }

  state.currentNode = state.walker.nextNode() ?? undefined
  while (state.currentNode) {
    state.nodes.push(state.currentNode)
    state.currentNode = state.walker.nextNode() ?? undefined
  }
  return state.nodes
 },

 findTextOffset = <TRoot extends Node,>(
  root: Readonly<TRoot>,
  node: ReadonlyDomNode,
  offset: number,
): number | undefined => {
  const textNodes = findTextNodes(root)
  let globalOffset = EMPTY_TEXT_LENGTH

  for (const currentNode of textNodes) {
    if (currentNode === node) {
      return globalOffset + Math.min(offset, currentNode.textContent?.length ?? EMPTY_TEXT_LENGTH)
    }

    const directTextOffset = getDirectTextNodeOffset(node, offset, currentNode, globalOffset)
    if (directTextOffset !== undefined) {
      return directTextOffset
    }

    globalOffset += currentNode.textContent?.length ?? EMPTY_TEXT_LENGTH
  }
  return undefined
 },

 getDirectTextNodeOffset = (
  node: ReadonlyDomNode,
  offset: number,
  currentNode: ReadonlyDomNode,
  globalOffset: number,
): number | undefined => {
  if (node.nodeType !== ELEMENT_NODE_TYPE || node !== currentNode.parentNode) {
    return undefined
  }

  let candidateOffset = globalOffset
  for (
    let index = FIRST_INDEX;
    index < Math.min(offset, node.childNodes.length);
    index += INDEX_INCREMENT
  ) {
    const child = node.childNodes[index]
    if (child === currentNode) {
      return candidateOffset
    }
    candidateOffset += child?.textContent?.length ?? EMPTY_TEXT_LENGTH
  }
  return undefined
 },

 getGlobalOffset = <TRoot extends Node,>(
  root: Readonly<TRoot>,
  node: ReadonlyDomNode,
  offset: number,
): number => {
  if (!isNodeWithinRoot(root, node) && node !== root) {
    return INVALID_OFFSET
  }

  const textOffset = findTextOffset(root, node, offset)
  if (textOffset !== undefined) {
    return textOffset
  }
  if (node === root) {
    return Math.min(offset, root.textContent?.length ?? EMPTY_TEXT_LENGTH)
  }
  return INVALID_OFFSET
 },

 isNodeWithinRoot = <TRoot extends Node,>(root: Readonly<TRoot>, node: ReadonlyDomNode): boolean => {
  let currentNode: ReadonlyDomNode | null = node
  while (currentNode) {
    if (currentNode === root) {
      return true
    }
    currentNode = currentNode.parentNode
  }
  return false
 }

export { getGlobalOffset }
