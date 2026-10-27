'use client'

import { useEffect, type ReactNode } from 'react'
import { EditorContent, useEditor, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import TextAlign from '@tiptap/extension-text-align'
import { TextStyle, FontFamily, FontSize, LineHeight } from '@tiptap/extension-text-style'
import { Color } from '@tiptap/extension-color'
import Highlight from '@tiptap/extension-highlight'
import Subscript from '@tiptap/extension-subscript'
import Superscript from '@tiptap/extension-superscript'
import { TableKit } from '@tiptap/extension-table'
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Bold,
  Columns3,
  Highlighter,
  IndentDecrease,
  IndentIncrease,
  Italic,
  Link2,
  List,
  ListOrdered,
  Quote,
  Redo2,
  RemoveFormatting,
  Rows3,
  Strikethrough,
  Subscript as SubscriptIcon,
  Superscript as SuperscriptIcon,
  Table2,
  Trash2,
  Underline as UnderlineIcon,
  Undo2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { isRichTextEmpty, normalizeRichHtml } from '@/lib/rich-text'
import { Indent } from '@/lib/tiptap-indent'

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

const FONT_FAMILIES = [
  { label: 'Default', value: '' },
  { label: 'Arial', value: 'Arial, Helvetica, sans-serif' },
  { label: 'Calibri', value: 'Calibri, Candara, Segoe UI, sans-serif' },
  { label: 'Georgia', value: 'Georgia, serif' },
  { label: 'Times New Roman', value: '"Times New Roman", Times, serif' },
  { label: 'Verdana', value: 'Verdana, Geneva, sans-serif' },
  { label: 'Tahoma', value: 'Tahoma, Geneva, sans-serif' },
  { label: 'Courier New', value: '"Courier New", Courier, monospace' },
  { label: 'Comic Sans', value: '"Comic Sans MS", "Segoe Print", cursive' },
]

const FONT_SIZES = [
  { label: 'Default', value: '' },
  { label: '10', value: '10px' },
  { label: '11', value: '11px' },
  { label: '12', value: '12px' },
  { label: '14', value: '14px' },
  { label: '16', value: '16px' },
  { label: '18', value: '18px' },
  { label: '20', value: '20px' },
  { label: '24', value: '24px' },
  { label: '28', value: '28px' },
  { label: '32', value: '32px' },
]

const LINE_HEIGHTS = [
  { label: 'Default', value: '' },
  { label: '1.0', value: '1' },
  { label: '1.15', value: '1.15' },
  { label: '1.5', value: '1.5' },
  { label: '1.75', value: '1.75' },
  { label: '2.0', value: '2' },
]

const selectClass =
  'h-7 max-w-[8.5rem] rounded border border-sky-200 bg-white px-1 text-[11px] text-slate-700 dark:border-sky-800/60 dark:bg-slate-950 dark:text-white dark:[color-scheme:dark]'

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
        'inline-flex h-7 w-7 items-center justify-center rounded border border-sky-200 text-slate-600 transition hover:bg-sky-50 hover:text-slate-900 disabled:opacity-40 dark:border-sky-800/60 dark:text-white dark:hover:bg-sky-950/60 dark:hover:text-white',
        active &&
          'border-sky-300 bg-sky-100 text-sky-900 hover:bg-sky-100 dark:border-sky-500 dark:bg-sky-900/70 dark:text-white dark:hover:bg-sky-900/70 dark:hover:text-white',
      )}
    >
      {children}
    </button>
  )
}

function ToolbarDivider() {
  return (
    <span
      className="mx-0.5 h-5 w-px shrink-0 bg-sky-200 dark:bg-sky-800/60"
      aria-hidden
    />
  )
}

function currentFontFamily(editor: Editor) {
  return (editor.getAttributes('textStyle').fontFamily as string) || ''
}

function currentFontSize(editor: Editor) {
  return (editor.getAttributes('textStyle').fontSize as string) || ''
}

function currentLineHeight(editor: Editor) {
  return (editor.getAttributes('textStyle').lineHeight as string) || ''
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
    <div className="flex flex-wrap items-center gap-0.5 border-b border-sky-200 bg-slate-50/90 px-1.5 py-1 dark:border-sky-800/60 dark:bg-slate-900/80">
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
        className={selectClass}
        disabled={disabled}
        aria-label="Font"
        value={currentFontFamily(editor)}
        onChange={(e) => {
          const v = e.target.value
          if (!v) editor.chain().focus().unsetFontFamily().run()
          else editor.chain().focus().setFontFamily(v).run()
        }}
      >
        {FONT_FAMILIES.map((f) => (
          <option key={f.label} value={f.value} style={f.value ? { fontFamily: f.value } : undefined}>
            {f.label}
          </option>
        ))}
      </select>

      <select
        className={cn(selectClass, 'max-w-[4.5rem]')}
        disabled={disabled}
        aria-label="Font size"
        value={currentFontSize(editor)}
        onChange={(e) => {
          const v = e.target.value
          if (!v) editor.chain().focus().unsetFontSize().run()
          else editor.chain().focus().setFontSize(v).run()
        }}
      >
        {FONT_SIZES.map((s) => (
          <option key={s.label} value={s.value}>
            {s.label}
          </option>
        ))}
      </select>

      <select
        className={cn(selectClass, 'max-w-[5.5rem]')}
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

      <select
        className={cn(selectClass, 'max-w-[4.75rem]')}
        disabled={disabled}
        aria-label="Line spacing"
        value={currentLineHeight(editor)}
        onChange={(e) => {
          const v = e.target.value
          if (!v) editor.chain().focus().unsetLineHeight().run()
          else editor.chain().focus().setLineHeight(v).run()
        }}
      >
        {LINE_HEIGHTS.map((h) => (
          <option key={h.label} value={h.value}>
            {h.label === 'Default' ? 'Line' : h.label}
          </option>
        ))}
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
      <ToolbarButton
        title="Subscript"
        active={editor.isActive('subscript')}
        disabled={disabled}
        onClick={() => editor.chain().focus().toggleSubscript().run()}
      >
        <SubscriptIcon className="size-3.5" />
      </ToolbarButton>
      <ToolbarButton
        title="Superscript"
        active={editor.isActive('superscript')}
        disabled={disabled}
        onClick={() => editor.chain().focus().toggleSuperscript().run()}
      >
        <SuperscriptIcon className="size-3.5" />
      </ToolbarButton>

      <ToolbarDivider />

      <label
        className="inline-flex h-7 items-center gap-1 rounded px-1 text-[11px] text-slate-600 dark:text-white"
        title="Font color"
      >
        <span className="sr-only">Font color</span>
        <input
          type="color"
          disabled={disabled}
          className="h-5 w-5 cursor-pointer rounded border border-sky-200 bg-white p-0 dark:border-sky-800/60"
          value={(editor.getAttributes('textStyle').color as string) || '#0f172a'}
          onChange={(e) => {
            editor.chain().focus().setColor(e.target.value).run()
          }}
        />
        <select
          className="h-6 max-w-[5.5rem] rounded border-0 bg-transparent text-[11px] dark:text-white dark:[color-scheme:dark]"
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
      <ToolbarButton
        title="Justify"
        active={editor.isActive({ textAlign: 'justify' })}
        disabled={disabled}
        onClick={() => editor.chain().focus().setTextAlign('justify').run()}
      >
        <AlignJustify className="size-3.5" />
      </ToolbarButton>

      <ToolbarDivider />

      <ToolbarButton
        title="Decrease indent"
        disabled={disabled}
        onClick={() => {
          if (!editor.chain().focus().liftListItem('listItem').run()) {
            editor.chain().focus().outdent().run()
          }
        }}
      >
        <IndentDecrease className="size-3.5" />
      </ToolbarButton>
      <ToolbarButton
        title="Increase indent"
        disabled={disabled}
        onClick={() => {
          if (!editor.chain().focus().sinkListItem('listItem').run()) {
            editor.chain().focus().indent().run()
          }
        }}
      >
        <IndentIncrease className="size-3.5" />
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
        title="Quote"
        active={editor.isActive('blockquote')}
        disabled={disabled}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
      >
        <Quote className="size-3.5" />
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
        title="Insert table"
        active={editor.isActive('table')}
        disabled={disabled}
        onClick={() =>
          editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
        }
      >
        <Table2 className="size-3.5" />
      </ToolbarButton>
      <ToolbarButton
        title="Add column"
        disabled={disabled || !editor.can().addColumnAfter()}
        onClick={() => editor.chain().focus().addColumnAfter().run()}
      >
        <Columns3 className="size-3.5" />
      </ToolbarButton>
      <ToolbarButton
        title="Add row"
        disabled={disabled || !editor.can().addRowAfter()}
        onClick={() => editor.chain().focus().addRowAfter().run()}
      >
        <Rows3 className="size-3.5" />
      </ToolbarButton>
      <ToolbarButton
        title="Delete table"
        disabled={disabled || !editor.can().deleteTable()}
        onClick={() => editor.chain().focus().deleteTable().run()}
      >
        <Trash2 className="size-3.5" />
      </ToolbarButton>

      <ToolbarDivider />

      <ToolbarButton
        title="Clear formatting"
        disabled={disabled}
        onClick={() =>
          editor.chain().focus().unsetAllMarks().clearNodes().unsetFontFamily().unsetFontSize().unsetLineHeight().run()
        }
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
      FontFamily,
      FontSize,
      LineHeight,
      Color,
      Highlight.configure({ multicolor: true }),
      Subscript,
      Superscript,
      TextAlign.configure({
        types: ['heading', 'paragraph'],
        alignments: ['left', 'center', 'right', 'justify'],
      }),
      Indent,
      TableKit.configure({
        table: {
          resizable: true,
          HTMLAttributes: { class: 'rich-text-table' },
        },
      }),
    ],
    content: normalizeRichHtml(value) || '',
    editorProps: {
      attributes: {
        class: cn(
          'prose prose-sm max-w-none px-2.5 py-2 text-sm text-slate-800 focus:outline-none dark:prose-invert dark:text-white',
          '[&_a]:text-sky-700 [&_a]:underline dark:[&_a]:text-sky-300',
          'dark:[&_p]:text-white dark:[&_h1]:text-white dark:[&_h2]:text-white dark:[&_h3]:text-white dark:[&_li]:text-white dark:[&_span]:text-inherit',
          '[&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5',
          '[&_h1]:text-lg [&_h1]:font-bold [&_h2]:text-base [&_h2]:font-bold [&_h3]:text-sm [&_h3]:font-semibold',
          '[&_blockquote]:border-l-2 [&_blockquote]:border-slate-300 [&_blockquote]:pl-3 [&_blockquote]:italic',
          '[&_table]:my-2',
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
          'rounded border border-sky-200 bg-white text-xs text-slate-400 dark:border-sky-800/60 dark:bg-slate-950 dark:text-slate-500',
          minHeightClass,
          className,
        )}
      >
        <div className="border-b border-sky-100 bg-slate-50 px-2 py-2 dark:border-sky-800/40 dark:bg-slate-900">
          Loading editor…
        </div>
      </div>
    )
  }

  return (
    <div
      className={cn(
        'overflow-hidden rounded border border-sky-200 bg-white shadow-sm focus-within:border-sky-300 focus-within:ring-1 focus-within:ring-sky-200 dark:border-sky-800/60 dark:bg-slate-950 dark:focus-within:border-sky-600 dark:focus-within:ring-sky-900/50',
        disabled && 'opacity-70',
        className,
      )}
    >
      <EditorToolbar editor={editor} disabled={disabled} />
      <EditorContent editor={editor} />
    </div>
  )
}
