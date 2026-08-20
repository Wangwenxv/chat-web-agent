import type { ElementType, ReactNode } from 'react'

export function MarkdownRenderer({ source }: { source: string }) {
  const fences: { language: string; code: string }[] = []
  const normalized = source.replace(
    /```([\w+-]*)\n([\s\S]*?)```/g,
    (_match, language: string, code: string) => {
      const index = fences.push({ language, code }) - 1
      return `\n@@CODE_${index}@@\n`
    },
  )
  const blocks = normalized.replace(/\r\n/g, '\n').split(/\n{2,}/)
  return (
    <div className="markdown-body">
      {blocks.map((block, index) => (
        <MarkdownBlock key={index} block={block} fences={fences} />
      ))}
    </div>
  )
}

function MarkdownBlock({
  block,
  fences,
}: {
  block: string
  fences: { language: string; code: string }[]
}): ReactNode {
  const trimmed = block.trim()
  if (!trimmed) return null
  const fence = trimmed.match(/^@@CODE_(\d+)@@$/)
  if (fence) {
    const code = fences[Number(fence[1])]
    if (code)
      return (
        <pre className="markdown-code">
          <code className={code.language ? `language-${code.language}` : undefined}>
            {code.code}
          </code>
        </pre>
      )
  }
  const heading = trimmed.match(/^(#{1,6})\s+(.+)$/)
  if (heading) {
    const Tag = `h${heading[1].length}` as ElementType
    return <Tag>{inlineMarkdown(heading[2])}</Tag>
  }
  const lines = trimmed.split('\n')
  if (lines.every((line) => /^\s*[-*+]\s+/.test(line)))
    return (
      <ul>
        {lines.map((line, index) => (
          <li key={index}>{inlineMarkdown(line.replace(/^\s*[-*+]\s+/, ''))}</li>
        ))}
      </ul>
    )
  if (lines.every((line) => /^\s*\d+[.)]\s+/.test(line)))
    return (
      <ol>
        {lines.map((line, index) => (
          <li key={index}>{inlineMarkdown(line.replace(/^\s*\d+[.)]\s+/, ''))}</li>
        ))}
      </ol>
    )
  return (
    <p>
      {lines.map((line, index) => (
        <span key={index}>
          {index > 0 && <br />}
          {inlineMarkdown(line)}
        </span>
      ))}
    </p>
  )
}

function inlineMarkdown(value: string): ReactNode[] {
  const nodes: ReactNode[] = []
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|_[^_]+_|\[[^\]]+\]\([^\s)]+\))/g
  let cursor = 0
  for (const match of value.matchAll(pattern)) {
    const start = match.index ?? 0
    if (start > cursor) nodes.push(value.slice(cursor, start))
    const token = match[0]
    if (token.startsWith('`')) nodes.push(<code key={`${start}-code`}>{token.slice(1, -1)}</code>)
    else if (token.startsWith('**') || token.startsWith('__'))
      nodes.push(<strong key={`${start}-strong`}>{token.slice(2, -2)}</strong>)
    else if (token.startsWith('*') || token.startsWith('_'))
      nodes.push(<em key={`${start}-em`}>{token.slice(1, -1)}</em>)
    else {
      const link = token.match(/^\[([^\]]+)\]\(([^\s)]+)\)$/)
      if (link && isSafeHref(link[2]))
        nodes.push(
          <a key={`${start}-link`} href={link[2]} target="_blank" rel="noreferrer">
            {link[1]}
          </a>,
        )
      else nodes.push(token)
    }
    cursor = start + token.length
  }
  if (cursor < value.length) nodes.push(value.slice(cursor))
  return nodes
}

function isSafeHref(value: string): boolean {
  try {
    const protocol = new URL(value, window.location.href).protocol
    return protocol === 'http:' || protocol === 'https:' || protocol === 'mailto:'
  } catch {
    return false
  }
}
