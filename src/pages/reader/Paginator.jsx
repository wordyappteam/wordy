import { useState, useRef, useLayoutEffect, forwardRef, useImperativeHandle } from 'react'
import { pageCount, pageOffset, pageOfOffsetLeft, clampPage } from '../../lib/pagination'
import Block from './Block'

export const FONT_SIZES = [16, 17, 18, 20, 22]
export const COLUMN_GAP = 56
const SERIF = 'Georgia, "Times New Roman", serif'

const Paginator = forwardRef(function Paginator(
  { blocks, imageSrcs, typography, lang, page, anchorBlock, onMeasure, onAnchorResolve, onWordTap, highlighted, knownWords, onResize },
  ref
) {
  const viewportRef = useRef(null)
  const contentRef = useRef(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const countRef = useRef(1)
  const prevWidthRef = useRef(0)

  useLayoutEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const measure = () => {
      const w = el.clientWidth, h = el.clientHeight
      if (prevWidthRef.current !== 0 && prevWidthRef.current !== w) onResize?.()
      prevWidthRef.current = w
      setSize({ w, h })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  function blockPage(blockIndex, w) {
    const el = contentRef.current?.querySelector(`[data-bi="${blockIndex}"]`)
    if (!el) return 0
    return pageOfOffsetLeft(el.offsetLeft, w, COLUMN_GAP)
  }

  // re-measure page count whenever layout inputs change
  useLayoutEffect(() => {
    if (!contentRef.current || size.w === 0) return
    const count = pageCount(contentRef.current.scrollWidth, size.w, COLUMN_GAP)
    countRef.current = count
    onMeasure(count)
    if (anchorBlock != null) {
      onAnchorResolve(clampPage(blockPage(anchorBlock, size.w), count))
    }
  }, [blocks, size, typography.step, typography.serif]) // eslint-disable-line react-hooks/exhaustive-deps

  useImperativeHandle(ref, () => ({
    firstBlockOfPage(p) {
      const els = contentRef.current?.querySelectorAll('[data-bi]') ?? []
      for (const el of els) {
        if (pageOfOffsetLeft(el.offsetLeft, size.w, COLUMN_GAP) >= p) return Number(el.dataset.bi)
      }
      return 0
    },
  }), [size])

  if (size.w === 0) return <div ref={viewportRef} className="flex-1 overflow-hidden" />

  return (
    <div ref={viewportRef} className="flex-1 overflow-hidden">
      <div
        ref={contentRef}
        lang={lang}
        className="text-gray-800"
        style={{
          columnWidth: size.w, columnGap: COLUMN_GAP, columnFill: 'auto',
          width: size.w, height: size.h,
          fontSize: FONT_SIZES[typography.step] ?? FONT_SIZES[2],
          fontFamily: typography.serif ? SERIF : 'inherit',
          lineHeight: 1.7, textAlign: 'justify',
          hyphens: 'auto', WebkitHyphens: 'auto',
          transform: `translateX(-${pageOffset(page, size.w, COLUMN_GAP)}px)`,
          transition: 'transform 200ms ease-out',
        }}
      >
        {blocks.map((block, i) => (
          <div key={i} data-bi={i}>
            <Block block={block} imageSrc={block.imageId ? imageSrcs[block.imageId] : undefined}
              onWordTap={onWordTap} highlighted={highlighted} knownWords={knownWords} />
          </div>
        ))}
      </div>
    </div>
  )
})

export default Paginator
