import { tokenize, getSentence, blockPlainText, normalizeWordForm } from '../../lib/readerText'

const BLOCK_CLASSES = {
  h1: 'text-2xl font-bold text-center mt-10 mb-6 [text-align:center]',
  h2: 'text-xl font-bold text-center mt-8 mb-4 [text-align:center]',
  h3: 'text-lg font-semibold mt-6 mb-3',
  h4: 'text-base font-semibold mt-5 mb-2',
  h5: 'text-base font-semibold mt-4 mb-2',
  h6: 'text-base font-semibold mt-4 mb-2',
  blockquote: 'pl-5 border-l-2 border-gray-300 my-4 text-gray-600',
  figcaption: 'text-center text-sm text-gray-500 my-2 [text-align:center]',
  verse: 'my-4 pl-4',
  p: 'mb-4',
}

function WordSpans({ text, plain, onWordTap, highlighted, knownWords }) {
  return tokenize(text).map(token =>
    token.isWord ? (
      <span
        key={token.key}
        onClick={(e) => { e.stopPropagation(); onWordTap(token.text, getSentence(plain, token.text)) }}
        className={`cursor-pointer rounded px-0.5 transition-colors select-none
          ${highlighted === token.text.toLowerCase()
            ? 'bg-yellow-200 text-gray-900'
            : knownWords?.has(normalizeWordForm(token.text))
            ? 'bg-indigo-50 text-indigo-800 hover:bg-yellow-100'
            : 'hover:bg-yellow-100'}`}
      >
        {token.text}
      </span>
    ) : (
      <span key={token.key}>{token.text}</span>
    )
  )
}

function Runs({ runs, plain, onWordTap, highlighted, knownWords }) {
  return runs.map((run, i) => {
    if (run.br) return <br key={i} />
    let node = <WordSpans text={run.text} plain={plain} onWordTap={onWordTap} highlighted={highlighted} knownWords={knownWords} />
    if (run.sup) return <sup key={i} className="text-xs text-gray-400 select-none">{run.text}</sup>
    if (run.em) node = <em key={i}>{node}</em>
    if (run.strong) node = <strong key={run.em ? `s${i}` : i}>{node}</strong>
    return run.em || run.strong ? node : <span key={i}>{node}</span>
  })
}

export default function Block({ block, imageSrc, onWordTap, highlighted, knownWords }) {
  if (block.type === 'hr') {
    return <div className="text-center text-gray-400 my-8 select-none tracking-[1em] [text-align:center]">✳</div>
  }
  if (block.type === 'image') {
    return (
      <div className="my-6 flex justify-center" style={{ breakInside: 'avoid' }}>
        {imageSrc
          ? <img src={imageSrc} alt={block.alt} className="max-w-full rounded" style={{ maxHeight: '70vh', objectFit: 'contain' }} />
          : <span className="text-xs text-gray-300">[image]</span>}
      </div>
    )
  }

  const plain = blockPlainText(block)
  const inner = <Runs runs={block.runs} plain={plain} onWordTap={onWordTap} highlighted={highlighted} knownWords={knownWords} />

  if (block.type === 'li') {
    return (
      <div className="flex gap-2 mb-1.5 ml-4">
        <span className="select-none text-gray-500 shrink-0">{block.listType === 'ol' ? `${block.listIndex}.` : '•'}</span>
        <span>{inner}</span>
      </div>
    )
  }

  const Tag = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote'].includes(block.type) ? block.type : 'p'
  const indent = block.quoteDepth ? { marginLeft: block.quoteDepth * 16 } : undefined
  return <Tag className={BLOCK_CLASSES[block.type] ?? BLOCK_CLASSES.p} style={indent}>{inner}</Tag>
}
