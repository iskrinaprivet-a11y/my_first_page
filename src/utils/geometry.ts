/**
 * ЧИСТАЯ МАТЕМАТИКА. Ни React, ни DOM, ни состояния — только функции.
 *
 * Благодаря этому пересчёт координат можно проверить обычным тестом,
 * а правила камеры не расползаются между компонентами.
 *
 * Главное правило файла:
 *   canvas = (screen - pan) / zoom
 *   screen = canvas * zoom + pan
 * Забытый /zoom — причина того, что фигуры «уезжают» относительно курсора.
 */

import type { Point, Rect, ScreenPoint, Shape, Viewport } from '../types/shape'
import { MAX_ZOOM, MIN_ZOOM } from '../constants/viewport'

/** Ограничить значение диапазоном [min, max]. */
export function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min
  return Math.min(Math.max(value, min), max)
}

/** Экранные координаты мыши → координаты канваса (с учётом зума и панорамирования). */
export function screenToCanvas(point: ScreenPoint, viewport: Viewport): Point {
  return {
    x: (point.x - viewport.panX) / viewport.zoom,
    y: (point.y - viewport.panY) / viewport.zoom,
  }
}

/** Координаты канваса → экранные координаты. */
export function canvasToScreen(point: Point, viewport: Viewport): ScreenPoint {
  return {
    x: point.x * viewport.zoom + viewport.panX,
    y: point.y * viewport.zoom + viewport.panY,
  }
}

/**
 * Смещение мыши в ЭКРАННЫХ пикселях → смещение в координатах канваса.
 *
 * Для перетаскивания это удобнее, чем screenToCanvas: точка «откуда» и точка
 * «куда» приходят одним жестом, а разность их координат и есть смещение.
 * Делим ровно на тот же zoom — правило файла не нарушается.
 */
export function screenDeltaToCanvas(delta: ScreenPoint, viewport: Viewport): Point {
  return {
    x: delta.x / viewport.zoom,
    y: delta.y / viewport.zoom,
  }
}

/**
 * Зум с фиксацией точки под курсором: точка канваса, которая была под
 * screenAnchor, остаётся под ней и после изменения зума. Без этого колесо
 * «уводит» холст в сторону.
 */
export function zoomViewportAt(
  viewport: Viewport,
  screenAnchor: ScreenPoint,
  nextZoom: number,
): Viewport {
  const zoom = clamp(nextZoom, MIN_ZOOM, MAX_ZOOM)
  if (zoom === viewport.zoom) return viewport

  const anchor = screenToCanvas(screenAnchor, viewport)

  return {
    zoom,
    panX: screenAnchor.x - anchor.x * zoom,
    panY: screenAnchor.y - anchor.y * zoom,
  }
}

/**
 * Прямоугольник по двум точкам протяжки. Если тянули вверх/влево, размер
 * отрицательный — нормализуем, чтобы width/height всегда были ≥ 0.
 */
export function rectFromPoints(start: Point, end: Point): Rect {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  }
}

/** Есть ли у прямоугольника ненулевая площадь. */
export function isRectVisible(rect: Rect): boolean {
  return rect.width > 0 && rect.height > 0
}

/** Пересекаются ли два прямоугольника (грубая проверка «фигура под курсором»). */
export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
}

/**
 * Прямоугольник, сдвинутый на дельту в координатах канваса.
 *
 * Мутировать bounds нельзя: та же ссылка на объект попадает в useShapes как
 * стартовое значение протяжки, и «на месте» двигаемая фигура поехала бы
 * вместе с ручкой. Возвращаем новый прямоугольник.
 */
export function translateRect(rect: Rect, delta: Point): Rect {
  return {
    x: rect.x + delta.x,
    y: rect.y + delta.y,
    width: rect.width,
    height: rect.height,
  }
}

/** Точка внутри прямоугольника. Границы считаем включёнными — по краю тоже цепляем. */
export function pointInRect(point: Point, rect: Rect): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  )
}

/**
 * Точка внутри эллипса, вписанного в прямоугольник.
 *
 * Именно эллипс, а не его габариты: прямоугольный хит-тест ловил бы клики
 * в углах мимо фигуры, и выделение «прыгало» бы на пустом месте.
 */
export function pointInEllipse(point: Point, rect: Rect): boolean {
  const radiusX = rect.width / 2
  const radiusY = rect.height / 2
  if (radiusX <= 0 || radiusY <= 0) return false

  // Растягиваем точку в единичную окружность: дальше обычная сумма квадратов.
  const dx = (point.x - (rect.x + radiusX)) / radiusX
  const dy = (point.y - (rect.y + radiusY)) / radiusY

  return dx * dx + dy * dy <= 1
}

/**
 * Передвинуть фигуры на дельту, отсчитывая её от origins — стартовых
 * габаритов, снятых в начале жеста.
 *
 * Считать от origins, а не от текущих bounds — обязательное условие: иначе
 * каждый кадр прибавлял бы шаг к уже сдвинутой фигуре и ошибка сложения
 * копилась до самого отпускания кнопки.
 *
 * Нулевая дельта не оптимизируется: функция обязана вернуть и origins, иначе
 * отмена жеста (нулевая дельта — как раз «вернуть на место») ничего бы не
 * сделала. Пустой шаг мыши отсекает вызывающий: ему видно, что точка не
 * сдвинулась, а эта функция об этом не знает.
 */
export function translateShapes(
  shapes: readonly Shape[],
  origins: ReadonlyMap<string, Rect>,
  offset: Point,
): readonly Shape[] {
  return shapes.map((shape) => {
    const origin = origins.get(shape.id)
    return origin ? { ...shape, bounds: translateRect(origin, offset) } : shape
  })
}

/**
 * Фигура под точкой — верхняя из переданных.
 *
 * Обход с конца: массив фигур упорядочен по отрисовке, значит последняя
 * лежит сверху и должна выиграть. Скрытые и заблокированные фигуры
 * мимоходом пропускаем — по ним нельзя ни попасть, ни сдвинуть.
 */
export function hitTestShape(point: Point, shapes: readonly Shape[]): Shape | null {
  for (let index = shapes.length - 1; index >= 0; index -= 1) {
    // noUncheckedIndexedAccess: элемент по индексу бывает undefined, даже
    // если цикл по длине массива. Пропуск — тоже защита от дырявого входа.
    const shape = shapes[index]
    if (!shape || !shape.visible || shape.locked) continue
    if (!isRectVisible(shape.bounds)) continue

    const inside =
      shape.kind === 'ellipse'
        ? pointInEllipse(point, shape.bounds)
        : pointInRect(point, shape.bounds)

    if (inside) return shape
  }

  return null
}
