import * as React from 'react'
import { ArrowLeftIcon, ChevronRightIcon, CircleHelpIcon, SearchIcon } from 'lucide-react'

import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
import { cn } from '@/lib/utils'
import { useOverlay } from '@/features/panel/bits'
import manual from './manual.md?raw'

// ── Manual: se parte por "## " (título), "grupo:" y "tags:" ─────────────
export interface Article {
  slug: string
  title: string
  group: string
  tags: string
  body: string
}

const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
const slugOf = (s: string) => fold(s).replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')

export function parseManual(text: string): Article[] {
  return text
    .replace(/<!--[\s\S]*?-->/g, '')
    .split(/^## /m)
    .slice(1)
    .map((chunk) => {
      const lines = chunk.split('\n')
      const title = lines[0].trim()
      let group = 'General'
      let tags = ''
      const rest: string[] = []
      for (const line of lines.slice(1)) {
        if (line.startsWith('grupo:')) group = line.slice(6).trim()
        else if (line.startsWith('tags:')) tags = line.slice(5).trim()
        else rest.push(line)
      }
      return { slug: slugOf(title), title, group, tags, body: rest.join('\n').trim() }
    })
}

export const ARTICLES = parseManual(manual)

function search(query: string) {
  const words = fold(query).split(/\s+/).filter(Boolean)
  if (!words.length) return ARTICLES
  return ARTICLES.map((a) => {
    const title = fold(a.title)
    const tags = fold(a.tags)
    const body = fold(a.body)
    let score = 0
    for (const w of words) {
      if (title.includes(w)) score += 5
      else if (tags.includes(w)) score += 3
      else if (body.includes(w)) score += 1
      else return null
    }
    return { a, score }
  })
    .filter((x): x is { a: Article; score: number } => x !== null)
    .sort((x, y) => y.score - x.score)
    .map((x) => x.a)
}

// ── Markdown mínimo: párrafos, listas y **negrita** ───────────────────
function inline(text: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') ? <b key={i} className="font-semibold text-foreground">{part.slice(2, -2)}</b> : part,
  )
}

function Body({ text }: { text: string }) {
  const blocks: React.ReactNode[] = []
  let list: { ordered: boolean; items: string[] } | null = null
  let para: string[] = []
  const flush = () => {
    if (para.length) blocks.push(<p key={blocks.length}>{inline(para.join(' '))}</p>)
    para = []
    if (list) {
      const items = list.items.map((it, i) => <li key={i}>{inline(it)}</li>)
      blocks.push(list.ordered ? <ol key={blocks.length} className="list-decimal space-y-1.5 pl-5 marker:font-semibold marker:text-[#a37800] dark:marker:text-[var(--brand-amber)]">{items}</ol> : <ul key={blocks.length} className="list-disc space-y-1.5 pl-5 marker:text-[var(--brand-amber)]">{items}</ul>)
      list = null
    }
  }
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    const ol = line.match(/^\d+\.\s+(.*)/)
    const ul = line.match(/^-\s+(.*)/)
    if (!line) flush()
    else if (ol || ul) {
      if (para.length) { blocks.push(<p key={blocks.length}>{inline(para.join(' '))}</p>); para = [] }
      const ordered = Boolean(ol)
      if (list && list.ordered !== ordered) flush()
      list ??= { ordered, items: [] }
      list.items.push((ol ?? ul)![1])
    } else para.push(line)
  }
  flush()
  return <div className="grid gap-3 text-[14px] leading-relaxed text-ink-2">{blocks}</div>
}

// ── Botón de la barra superior ─────────────────────────────────────────
export function HelpButton() {
  const help = useOverlay('ayuda')
  const open = Boolean(help.value)
  return (
    <button
      type="button"
      onClick={() => help.open('manual')}
      aria-label="Ayuda"
      title="Ayuda"
      className={cn(
        'grid size-10 place-items-center rounded-xl text-ink-2 transition-colors duration-200 hover:bg-[rgb(245_184_0/0.14)] hover:text-[#8a6100] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none dark:hover:text-[var(--brand-amber)]',
        open && 'bg-[rgb(245_184_0/0.14)] text-[#8a6100] dark:text-[var(--brand-amber)]',
      )}
    >
      <CircleHelpIcon className="size-[19px]" />
    </button>
  )
}

// ── Ventana de Ayuda ───────────────────────────────────────────────────
export function HelpSheet() {
  const help = useOverlay('ayuda')
  const [query, setQuery] = React.useState('')
  const current = ARTICLES.find((a) => a.slug === help.value)
  const results = search(query)
  const groups = Array.from(new Set(results.map((a) => a.group)))
  const scroller = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    scroller.current?.scrollTo({ top: 0 })
  }, [help.value])

  return (
    <Sheet open={Boolean(help.value)} onOpenChange={(o) => { if (!o) { help.close(); setQuery('') } }}>
      <SheetContent className="sm:max-w-[460px]" aria-describedby={undefined}>
        <div ref={scroller} className="flex h-full flex-col overflow-y-auto">
          <header className="sticky top-0 z-10 border-b border-line bg-card px-6 pt-5 pb-4">
            <div className="flex items-center gap-3 pr-10">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[var(--brand-amber)] text-[#111827]">
                <CircleHelpIcon className="size-5" strokeWidth={2.25} />
              </span>
              <div>
                <SheetTitle className="text-[17px] font-bold">Ayuda</SheetTitle>
                <SheetDescription className="text-xs text-muted-foreground">Manual del panel, paso a paso</SheetDescription>
              </div>
            </div>
            {current ? null : (
              <label className="relative mt-4 block">
                <span className="sr-only">Buscar en la ayuda</span>
                <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="search"
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="¿Qué necesitás hacer? Ej.: pago parcial"
                  className="h-10 w-full rounded-xl border border-border bg-background pr-3 pl-9 text-[13px] outline-none placeholder:text-muted-foreground/80 focus-visible:border-[var(--brand-amber)] focus-visible:ring-[3px] focus-visible:ring-[rgb(245_184_0/0.25)]"
                />
              </label>
            )}
          </header>

          {current ? (
            <article className="px-6 py-5">
              <button
                type="button"
                onClick={() => help.open('manual')}
                className="mb-4 inline-flex items-center gap-1.5 rounded-lg px-2 py-1 -ml-2 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <ArrowLeftIcon className="size-4" />
                Volver
              </button>
              <p className="text-[11px] font-semibold tracking-wider text-[#8a6100] uppercase dark:text-[var(--brand-amber)]">{current.group}</p>
              <h2 className="mt-1 mb-4 text-[20px] leading-tight font-bold">{current.title}</h2>
              <Body text={current.body} />
              <Related current={current} onOpen={(slug) => help.open(slug)} />
            </article>
          ) : (
            <nav aria-label="Artículos de ayuda" className="px-3 py-4">
              {results.length ? (
                groups.map((g) => (
                  <section key={g} className="mb-3">
                    <h3 className="flex items-center gap-2 px-3 pt-2 pb-1.5 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                      <span className="size-1.5 rounded-full bg-[var(--brand-amber)]" aria-hidden="true" />
                      {g}
                    </h3>
                    {results.filter((a) => a.group === g).map((a) => (
                      <ArticleRow key={a.slug} a={a} onOpen={() => help.open(a.slug)} />
                    ))}
                  </section>
                ))
              ) : (
                <div className="px-3 py-8 text-center">
                  <p className="text-[14px] font-semibold">No encontré nada con «{query}»</p>
                  <p className="mt-1 text-[13px] text-muted-foreground">Probá con otra palabra, por ejemplo <i>comprobante</i>, <i>ajuste</i> o <i>inquilino</i>.</p>
                </div>
              )}
            </nav>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}

function ArticleRow({ a, onOpen }: { a: Article; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group relative flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-[rgb(245_184_0/0.1)] before:absolute before:inset-y-2.5 before:left-0 before:w-[3px] before:rounded-full before:bg-[var(--brand-amber)] before:opacity-0 before:transition-opacity hover:before:opacity-100"
    >
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] font-medium">{a.title}</span>
        <span className="block truncate text-xs text-muted-foreground">{a.body.replace(/\*\*/g, '').split('\n')[0].replace(/^(\d+\.|-)\s+/, '').replace(/:$/, '')}</span>
      </span>
      <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground transition-transform duration-300 group-hover:translate-x-0.5" />
    </button>
  )
}

function Related({ current, onOpen }: { current: Article; onOpen: (slug: string) => void }) {
  const related = ARTICLES.filter((a) => a.group === current.group && a.slug !== current.slug)
  if (!related.length) return null
  return (
    <div className="mt-8 border-t border-line pt-5">
      <p className="mb-2 text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">También en {current.group}</p>
      <div className="-mx-3">
        {related.map((a) => <ArticleRow key={a.slug} a={a} onOpen={() => onOpen(a.slug)} />)}
      </div>
    </div>
  )
}
