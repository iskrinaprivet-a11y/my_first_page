/**
 * ПАНЕЛЬ СВОЙСТВ — справа сверху.
 *
 * Габариты пока только для чтения, а заливка и обводка редактируются:
 * нативный пикер <input type="color"> не требует ни библиотеки, ни своего
 * диалога, и на выбранном цвете сразу виден результат на холсте. У картинки
 * этих полей нет вообще, поэтому пикеры она не получает — см. ветку kind.
 *
 * Панель ничего не знает про состояние — получила фигуру и обработчик,
 * отдаёт патч по id.
 */

import { DEFAULT_FILL, DEFAULT_STROKE, SHAPE_LABELS } from '../constants/viewport'
import type { ShapePatch } from '../hooks/useShapes'
import type { Shape } from '../types/shape'

export interface PropertiesPanelProps {
  /** Выделенная фигура или null, если ничего не выбрано. */
  shape: Shape | null
  /** Точечно изменить фигуру. Вызывается на каждый выбор цвета. */
  onChange: (id: string, patch: ShapePatch) => void
}

function Row({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-center justify-between gap-2 py-1">
      <span className="text-[11px] text-slate-500">{label}</span>
      <span className="font-mono text-xs text-slate-200">{value}</span>
    </div>
  )
}

/** #rgb или #rrggbb — единственные формы, которые понимает пикер. */
const HEX_COLOR = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i

/**
 * Значение для <input type="color">. Фигур может получить цвет из импорта или
 * правки вручную, и если это не 6-значный hex, браузер начнёт ругаться в
 * консоль — молчаливый фолбэк безопаснее.
 */
function toPickerValue(color: string, fallback: string): string {
  if (!HEX_COLOR.test(color)) return fallback
  return color.length === 4
    ? `#${color[1]}${color[1]}${color[2]}${color[2]}${color[3]}${color[3]}`
    : color
}

interface ColorFieldProps {
  label: string
  color: string
  fallback: string
  onChange: (color: string) => void
}

function ColorField({ label, color, fallback, onChange }: ColorFieldProps) {
  // Локального состояния нет намеренно. <input type="color"> выдаёт значение
  // только целиком и сразу из готовым hex, поэтому «недописанного» значения не
  // бывает и контролировать его прямо из shape.fill безопасно: выбор цвета →
  // onChange → updateShape → новое значение → следующий рендер.
  const value = toPickerValue(color, fallback)

  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[11px] text-slate-500">{label}</span>
      <span className="flex items-center gap-1.5">
        <span
          className="h-4 w-4 rounded ring-1 ring-slate-600"
          style={{ backgroundColor: value }}
        />
        <input
          type="color"
          aria-label={`${label}: цвет`}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="h-6 w-8 cursor-pointer rounded border-0 bg-transparent p-0
            [&::-webkit-color-swatch-wrapper]:p-0.5
            [&::-webkit-color-swatch]:rounded [&::-webkit-color-swatch]:border-0"
        />
        <span className="font-mono text-xs text-slate-300">{value}</span>
      </span>
    </div>
  )
}

export default function PropertiesPanel({ shape, onChange }: PropertiesPanelProps) {
  return (
    <section className="flex flex-col gap-3 border-b border-slate-800 p-3">
      <header className="flex items-center justify-between">
        <h2 className="text-[11px] font-semibold tracking-wide text-slate-400 uppercase">
          Свойства
        </h2>
        {shape && (
          <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400">
            {SHAPE_LABELS[shape.kind]}
          </span>
        )}
      </header>

      {shape ? (
        <>
          <div className="grid grid-cols-2 gap-1.5">
            <Row label="X" value={Math.round(shape.bounds.x)} />
            <Row label="Y" value={Math.round(shape.bounds.y)} />
            <Row label="W" value={Math.round(shape.bounds.width)} />
            <Row label="H" value={Math.round(shape.bounds.height)} />
          </div>

          {shape.kind === 'image' ? (
            /* У картинки нет заливки и обводки — пикеров цвета здесь не может
               быть по типам, а не «скрыты за ненадобностью». Показываем
               собственный размер файла: по нему видно, во что он вписан. */
            <div className="space-y-1.5 border-t border-slate-800 pt-2">
              <Row label="Разрешение" value={`${shape.width} × ${shape.height}`} />
              <p className="text-[10px] leading-relaxed text-slate-600">
                Картинка вставлена из буфера или файла. Её можно двигать, удалять
                (Delete) и отменять (Ctrl+Z) так же, как любую фигуру.
              </p>
            </div>
          ) : (
            <div className="space-y-1.5 border-t border-slate-800 pt-2">
              <ColorField
                label="Заливка"
                color={shape.fill}
                fallback={DEFAULT_FILL}
                onChange={(fill) => onChange(shape.id, { fill })}
              />
              <ColorField
                label="Обводка"
                color={shape.stroke}
                fallback={DEFAULT_STROKE}
                onChange={(stroke) => onChange(shape.id, { stroke })}
              />
            </div>
          )}

          <p className="text-[10px] leading-relaxed text-slate-600">
            X / Y / W / H пока только для чтения — ввод координат и толщины обводки
            на следующем шаге.
          </p>
        </>
      ) : (
        <p className="text-[11px] leading-relaxed text-slate-500">
          Фигура не выбрана. Кликните по фигуре на холсте или по слою в панели
          слоёв, нарисуйте фигуру инструментом «Прямоугольник» (R) или «Эллипс»
          (O), либо вставьте картинку — Ctrl+V или перетащите файл в холст.
        </p>
      )}
    </section>
  )
}