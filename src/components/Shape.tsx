/**
 * ОДНА ФИГУРА. Чистый рендер по данным из types/shape.ts.
 *
 * Компонент ничего не знает про камеру, выделение и инструменты: получил
 * Shape — нарисовал. Прямоугольник и эллипс отличаются только скруглением,
 * картинка рисуется тегом <img> — но и она попадает сюда обычной фигурой:
 * с теми же габаритами, тем же хит-тестом и тем же перетаскиванием.
 *
 * Исключение — рамка выделения: если фигура выделена, поверх неё рисуется
 * рамка с восемью маркерами (4 угла + середины сторон). Она лежит в общей
 * системе координат канваса, поэтому размеры маркеров делятся на зум —
 * единственное, ради чего компоненту вообще нужен zoom.
 */

import {
  HANDLE_BORDER_PX,
  HANDLE_SIZE_PX,
  SELECTION_BORDER_PX,
  SELECTION_COLOR,
  SELECTION_GAP_PX,
} from '../constants/selection'
import type { Shape as ShapeData } from '../types/shape'
import { isRectVisible } from '../utils/geometry'

export interface ShapeProps {
  /** Модель фигуры. Позиция и размер — в координатах канваса. */
  shape: ShapeData
  /** Подсветить рамкой выделения. */
  isSelected?: boolean
  /**
   * Зум холста. Только для размера рамки и маркеров: их экранный размер не
   * должен зависеть от масштаба. Положение фигуры от зума не зависит — этим
   * занимается transform слоя фигур в Canvas.
   */
  zoom?: number
}

/**
 * Позиции маркеров в процентах от габаритов рамки. Проценты, а не координаты:
 * одна таблица работает для фигуры любого размера, и пересчитывать её
 * в useMemo не нужно — маркеров всего восемь.
 */
const HANDLE_POSITIONS = [
  { id: 'nw', left: 0, top: 0 },
  { id: 'n', left: 50, top: 0 },
  { id: 'ne', left: 100, top: 0 },
  { id: 'e', left: 100, top: 50 },
  { id: 'se', left: 100, top: 100 },
  { id: 's', left: 50, top: 100 },
  { id: 'sw', left: 0, top: 100 },
  { id: 'w', left: 0, top: 50 },
] as const

/**
 * Рамка выделения: прямоугольник вокруг фигуры + маркеры по его сторонам.
 *
 * Ввод она не перехватывает: попадание по фигуре и перетаскивание считает
 * хит-тест на канвасе (utils/geometry), поэтому маркеры — пока только
 * картинка, а не восемь самостоятельных кнопок.
 */
function SelectionFrame({ bounds, zoom }: { bounds: ShapeData['bounds']; zoom: number }) {
  const inverse = zoom > 0 ? 1 / zoom : 1

  const borderWidth = SELECTION_BORDER_PX * inverse
  const gap = SELECTION_GAP_PX * inverse
  const handleSize = HANDLE_SIZE_PX * inverse

  const { x, y, width, height } = bounds

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute"
      style={{
        left: x - gap,
        top: y - gap,
        width: width + gap * 2,
        height: height + gap * 2,
        border: `${borderWidth}px solid ${SELECTION_COLOR}`,
      }}
    >
      {HANDLE_POSITIONS.map((handle) => (
        <span
          key={handle.id}
          data-handle={handle.id}
          className="absolute block"
          style={{
            left: `${handle.left}%`,
            top: `${handle.top}%`,
            // Маркер центрируется по углу или середине стороны рамки.
            transform: 'translate(-50%, -50%)',
            width: handleSize,
            height: handleSize,
            backgroundColor: SELECTION_COLOR,
            border: `${HANDLE_BORDER_PX * inverse}px solid #0f172a`,
            borderRadius: 1,
          }}
        />
      ))}
    </div>
  )
}

export default function Shape({ shape, isSelected = false, zoom = 1 }: ShapeProps) {
  if (!shape.visible) return null

  const { x, y, width, height } = shape.bounds
  // Нулевые габариты — это протяжка на ноль пикселей, а не фигура.
  if (!isRectVisible({ x, y, width, height })) return null

  /**
   * Ввод картинка не перехватывает — ровно как и вектор: попадание под курсором
   * считает хит-тест на канвасе, а тянет фигуру useShapes. Поэтому <img> без
   * pointer-events и без собственного перетаскивания, а рамка выделения и
   * маркеры — те же самые, что у остальных фигур.
   */
  if (shape.kind === 'image') {
    return (
      <>
        <img
          src={shape.src}
          alt={shape.name}
          title={shape.name}
          // Нативный drag картинки конфликтовал бы с перетаскиванием фигуры и
          // перехватывал бы приём файлов: выключаем его явно.
          draggable={false}
          // max-w-none обязателен: в preflight Tailwind у <img> стоит
          // max-width:100%, а слой фигур — absolute без ширины, то есть
          // shrink-to-fit. Картинка тогда схлопывается в ноль ширины.
          className="absolute block max-w-none select-none"
          style={{
            left: x,
            top: y,
            width,
            height,
            // Габариты картинки уже пропорциональны её размеру, а object-fit
            // страхует их на будущее: когда появятся маркеры изменения размера,
            // картинка впишется в рамку, а не растянется.
            objectFit: 'contain',
          }}
        />

        {isSelected && <SelectionFrame bounds={shape.bounds} zoom={zoom} />}
      </>
    )
  }

  const isEllipse = shape.kind === 'ellipse'

  return (
    <>
      <div
        className="absolute"
        title={shape.name}
        style={{
          left: x,
          top: y,
          width,
          height,
          backgroundColor: shape.fill,
          border: `${shape.strokeWidth}px solid ${shape.stroke}`,
          borderRadius: isEllipse ? '50%' : '2px',
        }}
      />

      {isSelected && <SelectionFrame bounds={shape.bounds} zoom={zoom} />}
    </>
  )
}
