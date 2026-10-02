/**
 * СБОРКА ЭКРАНА.
 *
 * App — тонкий: он не считает геометрию и не пересчитывает координаты.
 * Его работа: создать источники состояния (камера, фигуры, горячие клавиши)
 * и разложить панели по экрану.
 *
 * Состояние фигур живёт ровно в ОДНОМ экземпляре useShapes — здесь. Раньше
 * хук вызывался ещё и внутри Canvas, из-за чего у холста и панелей были
 * два независимых списка фигур: нарисованное на холсте не появлялось в
 * панели слоёв, а выбранное в панели — на холсте. Теперь Canvas получает
 * данные и обработчики props'ами, как и все остальные панели.
 *
 * Раскладка:
 *   [ Toolbar |            Canvas             | Properties ]
 *   [        |                              | Layers     ]
 */

import { useCallback, useState } from 'react'

import Canvas from './components/Canvas'
import LayersPanel from './components/LayersPanel'
import PropertiesPanel from './components/PropertiesPanel'
import Toolbar from './components/Toolbar'
import { DEFAULT_TOOL } from './constants/tools'
import { useHotkeys } from './hooks/useHotkeys'
import { useShapes } from './hooks/useShapes'
import type { Tool } from './types/shape'

export default function App() {
  const {
    shapes,
    selectedIds,
    selectedShape,
    selectShape,
    toggleSelection,
    clearSelection,
    updateShape,
    insertImages,
    deleteSelected,
    isSelected,
    undo,
    redo,
    draw,
    move,
  } = useShapes()
  const [activeTool, setActiveTool] = useState<Tool>(DEFAULT_TOOL)

  const onEscape = useCallback(() => {
    // Escape отменяет незавершённый жест, а если его нет — снимает выделение.
    // Проверяем именно наличие жеста: иначе Escape во время протяжки мелькнул
    // бы выделением на долю секунды.
    if (draw.bounds) {
      draw.cancel()
      return
    }
    // Перетаскивание возвращает фигуру на исходное место.
    if (move.draggingId) {
      move.cancel()
      return
    }
    clearSelection()
  }, [clearSelection, draw, move])

  /**
   * Ctrl+Z с незавершённым жестом отменяет не документ, а сам жест: тот ещё
   * ничего не записал в историю, поэтому отменять там нечего.
   */
  const onUndo = useCallback(() => {
    if (draw.bounds) {
      draw.cancel()
      return
    }
    if (move.draggingId) {
      move.cancel()
      return
    }
    undo()
  }, [draw, move, undo])

  // Сочетания описаны в constants/tools.ts, здесь только обработчики.
  // Delete и Backspace разбирает сам useHotkeys — ему они не в HOTKEYS.
  useHotkeys({
    onToolChange: setActiveTool,
    onEscape,
    onUndo,
    onRedo: redo,
    onDelete: deleteSelected,
  })

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-slate-950 text-slate-200">
      <Toolbar activeTool={activeTool} onToolChange={setActiveTool} />

      <Canvas
        activeTool={activeTool}
        shapes={shapes}
        isSelected={isSelected}
        clearSelection={clearSelection}
        draw={draw}
        move={move}
        onInsertImages={insertImages}
      />

      <aside className="flex w-64 shrink-0 flex-col border-l border-slate-800 bg-slate-900">
        <PropertiesPanel shape={selectedShape} onChange={updateShape} />
        <LayersPanel
          shapes={shapes}
          selectedIds={selectedIds}
          onSelect={selectShape}
          onToggleSelect={toggleSelection}
        />
      </aside>
    </div>
  )
}