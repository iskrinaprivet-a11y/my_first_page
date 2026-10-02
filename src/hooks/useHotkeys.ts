/**
 * ГОРЯЧИЕ КЛАВИШИ.
 *
 * Хук ничего не знает про конкретные сочетания: он спрашивает таблицу HOTKEYS
 * (constants/tools.ts), какая команда соответствует нажатию, и вызывает её
 * обработчик. Добавить сочетание — значит дописать строку в константы.
 *
 * Слушатель на window, а не на холсте: фокус может стоять на панели слоёв, и
 * клавиши должны работать оттуда так же, как с холста.
 */

import { useEffect, useLayoutEffect, useRef } from 'react'

import { matchHotkey } from '../constants/tools'
import type { HotkeyCommand } from '../constants/tools'
import type { Tool } from '../types/shape'

export interface HotkeyHandlers {
  /** Сменить активный инструмент. Вызывается, если нажата клавиша инструмента. */
  onToolChange?: (tool: Tool) => void
  /** Escape — снять выделение / отменить действие. */
  onEscape?: () => void
  /** Delete / Backspace — удалить выделенное. */
  onDelete?: () => void
  /** Ctrl+Z — отменить последнее изменение. */
  onUndo?: () => void
  /** Ctrl+Shift+Z (Ctrl+Y) — вернуть отменённое. */
  onRedo?: () => void
}

/**
 * Не мешаем, если пользователь печатает в поле ввода.
 * Экспортируется наружу: Canvas использует ту же проверку для пробела.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

/** Раскрыть команду до конкретного обработчика: таблица не знает про React. */
function dispatch(command: HotkeyCommand, handlers: HotkeyHandlers): void {
  switch (command.type) {
    case 'tool':
      handlers.onToolChange?.(command.tool)
      return
    case 'undo':
      handlers.onUndo?.()
      return
    case 'redo':
      handlers.onRedo?.()
      return
    case 'escape':
      handlers.onEscape?.()
      return
  }
}

/**
 * @param handlers Обработчики команд. Пересоздаются на каждом рендере — хук
 *   всё равно подпишется один раз и прочитает свежие по ссылке из ref'а.
 * @param enabled Выключатель подписки. По умолчанию клавиши включены.
 */
export function useHotkeys(handlers: HotkeyHandlers, enabled = true): void {
  /**
   * Обработчики в ref'е, а подписка в useEffect — с зависимостью только от
   * enabled. Иначе объект handlers, новый на каждом рендере App, переподключал
   * бы слушатель на каждом кадре протяжки или перетаскивания.
   *
   * Зеркало обновляется в useLayoutEffect, а не прямо в теле хука: ref должен
   * меняться после фиксации рендера, и к моменту любого события в нём уже
   * лежит набор из последнего рендера — «залипших» ссылок на удалённые
   * компоненты здесь не бывает.
   */
  const handlersRef = useRef(handlers)
  useLayoutEffect(() => {
    handlersRef.current = handlers
  })

  useEffect(() => {
    if (!enabled) return

    function onKeyDown(event: KeyboardEvent) {
      // Печатаем — не перехватываем: иначе R в поле ввода выбрал бы инструмент,
      // а Ctrl+Z откатывал бы правку в самом поле.
      if (isTypingTarget(event.target)) return

      const command = matchHotkey(event)

      // Delete и Backspace разбираются здесь, а не в таблице HOTKEYS: у них
      // нет сочетания с модификатором, только имя клавиши.
      if (command === null) {
        if (event.key === 'Delete' || event.key === 'Backspace') {
          event.preventDefault()
          handlersRef.current.onDelete?.()
        }
        return
      }

      // Совпавшее сочетание выполняем сами и гасим его умолчание: иначе Ctrl+Z
      // откатит что-то в самом браузере, а Ctrl+Shift+Tab переключит вкладки.
      event.preventDefault()
      dispatch(command, handlersRef.current)
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [enabled])
}