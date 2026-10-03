/**
 * ПАНЕЛЬ СЛОЁВ — справа снизу. Список всех фигур; клик по строке выделяет
 * фигуру на холсте, поэтому состояние выделения здесь то же самое и то же
 * самое, что у рамки вокруг фигуры.
 *
 * Слой — это фигура. Порядок в списке обратный отрисовке: верхний слой списка
 * лежит поверх остальных, как в графических редакторах.
 *
 * Строка скрывает: цвет заливки, вид фигуры, габариты и состояние
 * (скрыта / заблокирована). Меняются они пока не здесь, но панель обязана
 * показывать правду — иначе она врёт о содержимом холста.
 *
 * Шаги 3–4: перетаскивание строк (порядок = z-index), глаз и замок кликом,
 * двойной клик для переименования.
 */

import { SHAPE_LABELS } from '../constants/viewport'
import type { Shape } from '../types/shape'

export interface LayersPanelProps {
  /** Все фигуры в порядке отрисовки: первая — снизу. */
  shapes: readonly Shape[]
  /** Что сейчас выделено на холсте. */
  selectedIds: readonly string[]
  /** Выделить слой кликом — как клик по фигуре на холсте. */
  onSelect: (id: string) => void
  /** Shift+клик по слою — добавить слой к выделению или снять из него. */
  onToggleSelect?: (id: string) => void
}

/** Одна строка списка: образец цвета, вид фигуры, имя и пометки состояния. */
function LayerRow({
  shape,
  isActive,
  onSelect,
  onToggleSelect,
}: {
  shape: Shape
  isActive: boolean
  onSelect: () => void
  onToggleSelect?: () => void
}) {
  const { x, y, width, height } = shape.bounds
  const position = `${Math.round(x)} × ${Math.round(y)}`
  const size = `${Math.round(width)} × ${Math.round(height)}`

  return (
    <button
      type="button"
      onClick={(event) => {
        // Shift+Ctrl на клике означает то же, что и на холсте: правим выделение,
        // не начиная перетаскивание фигуры.
        if (event.shiftKey || event.ctrlKey || event.metaKey) onToggleSelect?.()
        else onSelect()
      }}
      aria-pressed={isActive}
      title={`${shape.name} — ${position}, ${size}`}
      className={[
        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition',
        'outline-offset-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-400',
        isActive
          ? 'bg-sky-500/15 text-sky-200 ring-1 ring-sky-500/30'
          : 'text-slate-300 hover:bg-edge',
      ].join(' ')}
    >
      {/* Образец: форма повторяет вид фигуры, поэтому строка читается с одного взгляда.
          У картинки заливки нет — показываем её саму, иначе строка врала бы о
          содержимом холста, рисуя синий квадрат. */}
      {shape.kind === 'image' ? (
        <img
          src={shape.src}
          alt=""
          aria-hidden="true"
          draggable={false}
          className="h-3.5 w-3.5 shrink-0 object-cover ring-1 ring-slate-600"
          style={{ opacity: shape.visible ? 1 : 0.35 }}
        />
      ) : (
        <span
          aria-hidden="true"
          className="h-3.5 w-3.5 shrink-0 ring-1 ring-slate-600"
          style={{
            backgroundColor: shape.visible ? shape.fill : 'transparent',
            borderRadius: shape.kind === 'ellipse' ? '50%' : '2px',
            opacity: shape.visible ? 1 : 0.35,
          }}
        />
      )}

      <span className="truncate">{shape.name}</span>

      <span className="ml-auto flex shrink-0 items-center gap-1">
        {!shape.visible && <span className="text-[10px] text-slate-600">скрыт</span>}
        {shape.locked && <span className="text-[10px] text-amber-500/80">замок</span>}
        <span className="text-[10px] text-slate-600">{SHAPE_LABELS[shape.kind]}</span>
      </span>
    </button>
  )
}

export default function LayersPanel({
  shapes,
  selectedIds,
  onSelect,
  onToggleSelect,
}: LayersPanelProps) {
  // Последняя фигура в массиве рисуется сверху — значит, в списке идёт первой.
  const orderedLayers = [...shapes].reverse()

  return (
    <section className="flex min-h-0 flex-1 flex-col gap-2 p-3">
      <header className="flex items-center justify-between">
        <h2 className="text-[11px] font-semibold tracking-wide text-slate-400 uppercase">
          Слои
        </h2>
        <span className="text-[10px] text-slate-600">
          {shapes.length}
          {selectedIds.length > 0 && ` · выбрано ${selectedIds.length}`}
        </span>
      </header>

      {orderedLayers.length === 0 ? (
        <p className="text-[11px] leading-relaxed text-slate-500">
          Слоёв пока нет. Нарисуйте фигуру инструментом «Прямоугольник» (R) или «Эллипс»
          (O), либо вставьте картинку — Ctrl+V из буфера или файл перетащите в холст.
          Фигура появится здесь и сразу выделится.
        </p>
      ) : (
        <ul className="-mx-1 flex min-h-0 flex-col gap-0.5 overflow-y-auto">
          {orderedLayers.map((shape) => (
            <li key={shape.id}>
              <LayerRow
                shape={shape}
                isActive={selectedIds.includes(shape.id)}
                onSelect={() => onSelect(shape.id)}
                onToggleSelect={
                  onToggleSelect ? () => onToggleSelect(shape.id) : undefined
                }
              />
            </li>
          ))}
        </ul>
      )}

      <p className="mt-auto pt-2 text-[10px] leading-relaxed text-slate-600">
        Клик по слою — выделить фигуру на холсте, Shift+клик — добавить к выделению,
        Delete — удалить выделенное.
      </p>
    </section>
  )
}