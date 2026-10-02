/**
 * КОНСТАНТЫ ИНСТРУМЕНТОВ И ГОРЯЧИХ КЛАВИШ.
 *
 * Единственное место, где описаны инструменты и все сочетания клавиш:
 * R/O/V — инструменты, Ctrl+Z и Ctrl+Shift+Z — история, Escape — отмена.
 * Хотим поменять сочетание или добавить инструмент — правим этот файл,
 * а не ищем клавиши по всему проекту.
 *
 * Список сочетаний (HOTKEYS) — обычные данные, а не код: обработчик в
 * hooks/useHotkeys.ts ничего не знает про конкретные буквы и просто спрашивает
 * таблицу, какая команда соответствует нажатию.
 */

import type { ShapeKind, Tool } from '../types/shape'

export interface ToolDefinition {
  /** Идентификатор, совпадает с Tool. */
  readonly id: Tool
  /** Подпись в тулбаре. */
  readonly label: string
  /** Горячая клавиша без модификаторов: R / O / V. */
  readonly shortcut: string
  /** Короткая подсказка в тулбаре. */
  readonly hint: string
}

/** Панель инструментов рисует именно этот массив — порядок = порядок в UI. */
export const TOOLS: readonly ToolDefinition[] = [
  { id: 'select', label: 'Выделение', shortcut: 'V', hint: 'Двигать и выделять' },
  { id: 'rectangle', label: 'Прямоугольник', shortcut: 'R', hint: 'Нарисовать прямоугольник' },
  { id: 'ellipse', label: 'Эллипс', shortcut: 'O', hint: 'Нарисовать эллипс' },
] as const

/** Инструмент, активный при запуске. */
export const DEFAULT_TOOL: Tool = 'select'

/**
 * Рисующий инструмент или нет. Всё, что не выделение, тянет новую фигуру.
 *
 * Оформлено как type guard, а не как `boolean`: вызов isDrawTool(activeTool)
 * сужает Tool до ShapeKind, поэтому в begin() уходит ровно рисующий
 * инструмент, и TypeScript не даст протащить туда 'select'.
 */
export function isDrawTool(tool: Tool): tool is ShapeKind {
  return tool !== 'select'
}

/* ── Горячие клавиши ─────────────────────────────────────────────────────── */

/**
 * Что означает нажатое сочетание. Обработчик получает команду и решает, что
 * с ней делать: про инструмент знает только App, про историю — useShapes.
 */
export type HotkeyCommand =
  | { readonly type: 'tool'; readonly tool: Tool }
  | { readonly type: 'undo' }
  | { readonly type: 'redo' }
  | { readonly type: 'escape' }

/** Одно сочетание клавиш. */
export interface HotkeyDefinition {
  readonly command: HotkeyCommand
  /**
   * Физическая клавиша, как её сообщает KeyboardEvent.code: 'KeyR', 'KeyZ',
   * 'Escape'.
   *
   * Именно code, а не event.key: буква зависит от раскладки, и на русской
   * раскладке event.key у R равна «к». Физическая клавиша ведёт себя как в
   * Figma — инструмент переключается при любой раскладке.
   */
  readonly code: string
  /** Ctrl. На macOS браузер шлёт metaKey, поэтому условие одно на обе платформы. */
  readonly primary?: boolean
  /**
   * Shift: true — обязателен, false (по умолчанию) — запрещён,
   * 'any' — не важен. Клавиши инструментов не требуют чистого нажатия:
   * Shift+R переключает инструмент так же, как R.
   */
  readonly shift?: boolean | 'any'
  /** Подпись для подсказок в интерфейсе. */
  readonly hint: string
}

/** Ровно те поля события, которые нужны для сравнения: KeyboardEvent подходит как есть. */
export interface HotkeyEvent {
  readonly code: string
  readonly ctrlKey: boolean
  readonly metaKey: boolean
  readonly shiftKey: boolean
  readonly altKey: boolean
}

/** Подписи истории изменений для интерфейса. */
export const UNDO_HINT = 'Ctrl+Z'
export const REDO_HINT = 'Ctrl+Shift+Z'

/**
 * Клавиши инструментов берём из TOOLS: добавили инструмент с полем shortcut —
 * сочетание появилось само, дублировать буквы вручную не нужно.
 */
const TOOL_HOTKEYS: readonly HotkeyDefinition[] = TOOLS.map((tool) => ({
  command: { type: 'tool', tool: tool.id },
  code: `Key${tool.shortcut.toUpperCase()}`,
  shift: 'any',
  hint: tool.shortcut,
}))

/** Все сочетания проекта. Подходит первое совпадение, порядок ничего не решает. */
export const HOTKEYS: readonly HotkeyDefinition[] = [
  ...TOOL_HOTKEYS,
  { command: { type: 'undo' }, code: 'KeyZ', primary: true, hint: UNDO_HINT },
  { command: { type: 'redo' }, code: 'KeyZ', primary: true, shift: true, hint: REDO_HINT },
  // Ctrl+Y — вторая, привычная руке на Windows, привязка к тому же redo.
  { command: { type: 'redo' }, code: 'KeyY', primary: true, hint: REDO_HINT },
  { command: { type: 'escape' }, code: 'Escape', hint: 'Esc' },
]

/**
 * Команда по событию клавиатуры или null, если такого сочетания нет.
 *
 * Alt не поддерживается ни одним сочетанием и всегда отменяет совпадение, а
 * Ctrl обязателен ровно там, где он описан: Ctrl+R остаётся перезагрузкой
 * страницы и не переключает инструмент.
 */
export function matchHotkey(event: HotkeyEvent): HotkeyCommand | null {
  if (event.altKey) return null

  const primary = event.ctrlKey || event.metaKey

  for (const hotkey of HOTKEYS) {
    if (hotkey.code !== event.code) continue
    if (Boolean(hotkey.primary) !== primary) continue
    if (hotkey.shift !== 'any' && Boolean(hotkey.shift) !== event.shiftKey) continue
    return hotkey.command
  }

  return null
}
