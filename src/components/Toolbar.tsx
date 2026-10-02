/**
 * ТУЛБАР — панель инструментов слева. Каркас шага 1.
 *
 * Рисует массив TOOLS из constants/tools.ts: добавили инструмент в константы —
 * кнопка появилась сама, ничего дописывать здесь не нужно.
 */

import { TOOLS } from '../constants/tools'
import type { Tool } from '../types/shape'

export interface ToolbarProps {
  /** Сейчас выбранный инструмент. */
  activeTool: Tool
  /** Выбрать инструмент по клику. */
  onToolChange: (tool: Tool) => void
}

/** Мини-иконки: тот же размер во всех трёх, чтобы ряд читался как колонка. */
function ToolIcon({ id }: { id: Tool }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6 } as const

  if (id === 'rectangle') {
    return (
      <svg viewBox="0 0 20 20" className="h-5 w-5" aria-hidden="true">
        <rect x="3.5" y="5.5" width="13" height="9" rx="1.5" {...common} />
      </svg>
    )
  }

  if (id === 'ellipse') {
    return (
      <svg viewBox="0 0 20 20" className="h-5 w-5" aria-hidden="true">
        <circle cx="10" cy="10" r="6.5" {...common} />
      </svg>
    )
  }

  return (
    <svg viewBox="0 0 20 20" className="h-5 w-5" aria-hidden="true">
      <path d="M5 3.5 15 10l-4.2 1.1L8.6 16z" {...common} strokeLinejoin="round" />
    </svg>
  )
}

export default function Toolbar({ activeTool, onToolChange }: ToolbarProps) {
  return (
    <aside className="flex w-16 shrink-0 flex-col items-center gap-1 border-r border-slate-800 bg-slate-900 py-3">
      {TOOLS.map((tool) => {
        const isActive = tool.id === activeTool

        return (
          <button
            key={tool.id}
            type="button"
            onClick={() => onToolChange(tool.id)}
            title={`${tool.label} (${tool.shortcut}) — ${tool.hint}`}
            aria-pressed={isActive}
            className={[
              'flex h-11 w-11 flex-col items-center justify-center gap-0.5 rounded-lg transition',
              isActive
                ? 'bg-sky-500/15 text-sky-300 ring-1 ring-sky-500/40'
                : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200',
            ].join(' ')}
          >
            <ToolIcon id={tool.id} />
            <kbd className="text-[10px] leading-none opacity-70">{tool.shortcut}</kbd>
          </button>
        )
      })}
    </aside>
  )
}
