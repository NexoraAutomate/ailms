'use client'

import { useEffect, type ReactNode } from 'react'
import { EditorContent, useEditor, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import TextAlign from '@tiptap/extension-text-align'
import { TextStyle } from '@tiptap/extension-text-style'
import { Color } from '@tiptap/extension-color'
import Highlight from '@tiptap/extension-highlight'
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Highlighter,
  Italic,
  Link2,
  List,
  ListOrdered,
  Redo2,
  RemoveFormatting,
  Strikethrough,
  Underline as UnderlineIcon,
  Undo2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { isRichTextEmpty, normalizeRichHtml } from '@/lib/rich-text'

const TEXT_COLORS = [
  { label: 'Default', value: '' },
  { label: 'Black', value: '#0f172a' },
  { label: 'Gray', value: '#64748b' },
  { label: 'Red', value: '#dc2626' },
  { label: 'Orange', value: '#ea580c' },
  { label: 'Green', value: '#16a34a' },
  { label: 'Blue', value: '#2563eb' },
  { label: 'Purple', value: '#7c3aed' },
]

type RichTextEditorProps = {
  value: string
  onChange: (html: string) => void
  placeholder?: string
  disabled?: boolean
  className?: string
  minHeightClass?: string
  'aria-label'?: string
}

function ToolbarButton({
  onClick,
  active,
  disabled,
  title,
  children,
}: {
  onClick: () => void
  active?: boolean
  disabled?: boolean
  title: string
  children: ReactNode
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active ? true : undefined}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={cn(
        'inline-flex h-7 w-7 items-center justify-center rounded text-slate-600 transition hover:bg-slate-200/80 hover:text-slate-900 disabled:opacity-40',
        active && 'bg-sky-100 text-sky-800 hover:bg-sky-100',
      )}
    >
      {children}
    </button>
  )
}

function ToolbarDivider() {
  return <span className="mx-0.5 h-5 w-px shrink-0 bg-slate-200" aria-hidden />
}

function EditorToolbar({ editor, disabled }: { editor: Editor; disabled?: boolean }) {
  const setLink = () => {
    const prev = editor.getAttributes('link').href as string | undefined
    const url = window.prompt('Link URL', prev || 'https://')
    if (url === null) return
    const trimmed = url.trim()
    if (!trimmed) {
      editor.chain().focus().extendMarkRange('link').unsetLink().run()
      return
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: trimmed }).run()
  }

  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b border-slate-200 bg-slate-50/90 px-1.5 py-1">
      <ToolbarButton
        title="Undo"
        disabled={disabled || !editor.can().undo()}
        onClick={() => editor.chain().focus().undo().run()}
      >
        <Undo2 className="size-3.5" />
      </ToolbarButton>
      <ToolbarButton
        title="Redo"
        disabled={disabled || !editor.can().redo()}
        onClick={() => editor.chain().focus().redo().run()}
      >
        <Redo2 className="size-3.5" />
      </ToolbarButton>

      <ToolbarDivider />

      <select
        className="h-7 max-w-[7.5rem] rounded border border-slate-200 bg-white px-1 text-[11px] text-slate-700"
        disabled={disabled}
        aria-label="Text style"
        value={
          editor.isActive('heading', { level: 1 })
            ? 'h1'
            : editor.isActive('heading', { level: 2 })
              ? 'h2'
              : editor.isActive('heading', { level: 3 })
                ? 'h3'
                : 'p'
        }
        onChange={(e) => {
          const v = e.target.value
          const chain = editor.chain().focus()
          if (v === 'p') chain.setParagraph().run()
          else if (v === 'h1') chain.toggleHeading({ level: 1 }).run()
          else if (v === 'h2') chain.toggleHeading({ level: 2 }).run()
          else if (v === 'h3') chain.toggleHeading({ level: 3 }).run()
        }}
      >
        <option value="p">Paragraph</option>
        <option value="h1">Heading 1</option>
        <option value="h2">Heading 2</option>
        <option value="h3">Heading 3</option>
      </select>

      <ToolbarDivider />

      <ToolbarButton
        title="Bold"
        active={editor.isActive('bold')}
        disabled={disabled}
        onClick={() => editor.chain().focus().toggleBold().run()}
      >
        <Bold className="size-3.5" />
      </ToolbarButton>
      <ToolbarButton
        title="Italic"
        active={editor.isActive('italic')}
        disabled={disabled}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      >
        <Italic className="size-3.5" />
      </ToolbarButton>
      <ToolbarButton
        title="Underline"
        active={editor.isActive('underline')}
        disabled={disabled}
        onClick={() => editor.chain().focus().toggleUnderline().run()}
      >
        <UnderlineIcon className="size-3.5" />
      </ToolbarButton>
      <ToolbarButton
        title="Strikethrough"
        active={editor.isActive('strike')}
        disabled={disabled}
        onClick={() => editor.chain().focus().toggleStrike().run()}
      >
        <Strikethrough className="size-3.5" />
      </ToolbarButton>

      <ToolbarDivider />

      <label className="inline-flex h-7 items-center gap-1 rounded px-1 text-[11px] text-slate-600" title="Font color">
        <span className="sr-only">Font color</span>
        <input
          type="color"
          disabled={disabled}
          className="h-5 w-5 cursor-pointer rounded border border-slate-200 bg-white p-0"
          value={(editor.getAttributes('textStyle').color as string) || '#0f172a'}
          onChange={(e) => {
            const color = e.target.value
            editor.chain().focus().setColor(color).run()
          }}
        />
        <select
          className="h-6 max-w-[5.5rem] rounded border-0 bg-transparent text-[11px]"
          disabled={disabled}
          aria-label="Font color preset"
          value={(editor.getAttributes('textStyle').color as string) || ''}
          onChange={(e) => {
            const v = e.target.value
            if (!v) editor.chain().focus().unsetColor().run()
            else editor.chain().focus().setColor(v).run()
          }}
        >
          {TEXT_COLORS.map((c) => (
            <option key={c.label} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </label>

      <ToolbarButton
        title="Highlight"
        active={editor.isActive('highlight')}
        disabled={disabled}
        onClick={() => editor.chain().focus().toggleHighlight({ color: '#fef08a' }).run()}
      >
        <Highlighter className="size-3.5" />
      </ToolbarButton>

      <ToolbarDivider />

      <ToolbarButton
        title="Align left"
        active={editor.isActive({ textAlign: 'left' })}
        disabled={disabled}
        onClick={() => editor.chain().focus().setTextAlign('left').run()}
      >
        <AlignLeft className="size-3.5" />
      </ToolbarButton>
      <ToolbarButton
        title="Align center"
        active={editor.isActive({ textAlign: 'center' })}
        disabled={disabled}
        onClick={() => editor.chain().focus().setTextAlign('center').run()}
      >
        <AlignCenter className="size-3.5" />
      </ToolbarButton>
      <ToolbarButton
        title="Align right"
        active={editor.isActive({ textAlign: 'right' })}
        disabled={disabled}
        onClick={() => editor.chain().focus().setTextAlign('right').run()}
      >
        <AlignRight className="size-3.5" />
      </ToolbarButton>

      <ToolbarDivider />

      <ToolbarButton
        title="Bulleted list"
        active={editor.isActive('bulletList')}
        disabled={disabled}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      >
        <List className="size-3.5" />
      </ToolbarButton>
      <ToolbarButton
        title="Numbered list"
        active={editor.isActive('orderedList')}
        disabled={disabled}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      >
        <ListOrdered className="size-3.5" />
      </ToolbarButton>
      <ToolbarButton
        title="Insert link"
        active={editor.isActive('link')}
        disabled={disabled}
        onClick={setLink}
      >
        <Link2 className="size-3.5" />
      </ToolbarButton>

      <ToolbarDivider />

      <ToolbarButton
        title="Clear formatting"
        disabled={disabled}
        onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()}
      >
        <RemoveFormatting className="size-3.5" />
      </ToolbarButton>
    </div>
  )
}

export function RichTextEditor({
  value,
  onChange,
  placeholder = 'Write a message…',
  disabled = false,
  className,
  minHeightClass = 'min-h-[6.5rem]',
  'aria-label': ariaLabel,
}: RichTextEditorProps) {
  const editor = useEditor({
    immediatelyRender: false,
    editable: !disabled,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        codeBlock: false,
        code: false,
      }),
      Placeholder.configure({ placeholder }),
      TextStyle,
      Color,
      Highlight.configure({ multicolor: true }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
    ],
    content: normalizeRichHtml(value) || '',
    editorProps: {
      attributes: {
        class: cn(
          'prose prose-sm max-w-none px-2.5 py-2 text-sm text-slate-800 focus:outline-none',
          '[&_a]:text-sky-700 [&_a]:underline',
          '[&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5',
          '[&_h1]:text-lg [&_h1]:font-bold [&_h2]:text-base [&_h2]:font-bold [&_h3]:text-sm [&_h3]:font-semibold',
          minHeightClass,
        ),
        ...(ariaLabel ? { 'aria-label': ariaLabel } : {}),
      },
    },
    onUpdate: ({ editor: ed }) => {
      const html = ed.getHTML()
      onChange(isRichTextEmpty(html) ? '' : html)
    },
  })

  useEffect(() => {
    if (!editor) return
    editor.setEditable(!disabled)
  }, [disabled, editor])

  // Sync external value (hydration / recipient switch) without fighting typing.
  useEffect(() => {
    if (!editor) return
    const incoming = normalizeRichHtml(value) || ''
    const current = editor.getHTML()
    const incomingEmpty = isRichTextEmpty(incoming)
    const currentEmpty = isRichTextEmpty(current)
    if (incomingEmpty && currentEmpty) return
    if (incoming === current) return
    editor.commands.setContent(incoming || '', { emitUpdate: false })
  }, [editor, value])

  if (!editor) {
    return (
      <div
        className={cn(
          'rounded border border-slate-200 bg-white text-xs text-slate-400',
          minHeightClass,
          className,
        )}
      >
        <div className="border-b border-slate-100 bg-slate-50 px-2 py-2">Loading editor…</div>
      </div>
    )
  }

  return (
    <div
      className={cn(
        'overflow-hidden rounded border border-slate-200 bg-white shadow-sm focus-within:border-sky-300 focus-within:ring-1 focus-within:ring-sky-200',
        disabled && 'opacity-70',
        className,
      )}
    >
      <EditorToolbar editor={editor} disabled={disabled} />
      <EditorContent editor={editor} />
    </div>
  )
}
