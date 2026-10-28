import { Extension } from '@tiptap/core'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    indent: {
      indent: () => ReturnType
      outdent: () => ReturnType
    }
  }
}

type IndentOptions = {
  types: string[]
  minLevel: number
  maxLevel: number
  stepPx: number
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n))
}

/** Paragraph / heading indent via margin-left (Outlook-like Tab / Shift+Tab). */
export const Indent = Extension.create<IndentOptions>({
  name: 'indent',

  addOptions() {
    return {
      types: ['paragraph', 'heading', 'blockquote'],
      minLevel: 0,
      maxLevel: 8,
      stepPx: 24,
    }
  },

  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          indent: {
            default: 0,
            parseHTML: (element) => {
              const raw = element.style.marginLeft || element.style.paddingLeft || ''
              const px = parseInt(raw, 10)
              if (!Number.isFinite(px) || px <= 0) return 0
              return clamp(Math.round(px / this.options.stepPx), this.options.minLevel, this.options.maxLevel)
            },
            renderHTML: (attributes) => {
              const level = Number(attributes.indent) || 0
              if (level <= 0) return {}
              return { style: `margin-left: ${level * this.options.stepPx}px` }
            },
          },
        },
      },
    ]
  },

  addCommands() {
    const updateIndent = (delta: number) => {
      return ({ state, dispatch, tr }: { state: import('@tiptap/pm/state').EditorState; dispatch?: (tr: import('@tiptap/pm/state').Transaction) => void; tr: import('@tiptap/pm/state').Transaction }) => {
        const { selection } = state
        const { from, to } = selection
        let changed = false
        state.doc.nodesBetween(from, to, (node, pos) => {
          if (!this.options.types.includes(node.type.name)) return
          const current = Number(node.attrs.indent) || 0
          const next = clamp(current + delta, this.options.minLevel, this.options.maxLevel)
          if (next === current) return
          tr.setNodeMarkup(pos, undefined, { ...node.attrs, indent: next })
          changed = true
        })
        if (changed && dispatch) dispatch(tr)
        return changed
      }
    }

    return {
      indent: () => updateIndent(1),
      outdent: () => updateIndent(-1),
    }
  },

  addKeyboardShortcuts() {
    return {
      Tab: () => {
        if (this.editor.commands.sinkListItem('listItem')) return true
        return this.editor.commands.indent()
      },
      'Shift-Tab': () => {
        if (this.editor.commands.liftListItem('listItem')) return true
        return this.editor.commands.outdent()
      },
    }
  },
})
