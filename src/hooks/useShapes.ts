/**
 * СОСТОЯНИЕ ФИГУР. Логика без интерфейса.
 *
 * Список фигур, добавление, изменение, выделение. Ни о камере, ни о мыши,
 * ни о JSX — поэтому панели и канвас работают с одними и теми же данными.
 *
 * Здесь же живут оба жизненных цикла жестов: протяжка новой фигуры и
 * перетаскивание выделенной: begin → update → commit / cancel.
 * Canvas не считает геометрию сам — он присылает экранные пиксели мыши,
 * а перевод в координаты канваса с учётом зума и панорамирования делает
 * utils/geometry (правило файла: canvas = (screen - pan) / zoom).
 *
 * И история изменений: undo/redo (Ctrl+Z / Ctrl+Shift+Z) хранят снимки
 * состояния, поэтому отменяется не отдельный вызов, а результат жеста целиком.
 *
 * И вставка картинок из буфера обмена и из перетаскивания файлов: файл
 * декодируется браузером, из него получается ImageShape, и фигура встаёт на
 * холст как любая другая — её можно выделить, сдвинуть и удалить. Правило
 * координат то же: на вход экранные пиксели и камера, перевод делает хук.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { MAX_IMAGE_EDGE_PX } from '../constants/images'
import {
  DEFAULT_FILL,
  DEFAULT_STROKE,
  DEFAULT_STROKE_WIDTH,
  HISTORY_LIMIT,
  MIN_DRAG_SCREEN_PX,
  SHAPE_LABELS,
} from '../constants/viewport'
import {
  hitTestShape,
  isRectVisible,
  rectFromPoints,
  screenDeltaToCanvas,
  screenToCanvas,
  translateShapes,
} from '../utils/geometry'
import { readImageFile } from '../utils/images'
import type { LoadedImage } from '../utils/images'
import type {
  ImageShape,
  Point,
  Rect,
  ScreenPoint,
  Shape,
  ShapeBase,
  ShapeKind,
  VectorShape,
  Viewport,
} from '../types/shape'

/**
 * Поля, которые можно изменить у существующей фигуры.
 *
 * Собраны из двух источников: общие поля ShapeBase доступны любой фигуре,
 * а заливка, обводка и её толщина — только векторной (у картинки их нет вовсе,
 * и панель свойств их ей и не предлагает).
 *
 * Взяты у конкретных интерфейсов, а не у объединения Shape: keyset объединения
 * — это пересечение полей, и Patch из него потерял бы и fill, и bounds.
 */
export type ShapePatch = Partial<Omit<ShapeBase, 'id' | 'kind'>> &
  Partial<Pick<VectorShape, 'fill' | 'stroke' | 'strokeWidth'>>

/**
 * Незавершённая протяжка. Хранится в ref, а не в состоянии: commit обязан
 * прочитать её СИНХРОННО и один раз. Состояние для этого не годится — его
 * значение может ещё не попасть в текущий рендер, а обновление внутри
 * setState-функции в StrictMode вызывается дважды, то есть фигура создалась бы
 * дублем.
 */
interface ShapeDraft {
  kind: ShapeKind
  /** Старт в координатах канваса — от него строится прямоугольник. */
  start: Point
  /** Старт в экранных пикселях — по нему отсекается случайный щелчок. */
  startScreen: ScreenPoint
  /** Последняя известная точка в экранных пикселях. */
  lastScreen: ScreenPoint
  /** Текущие габариты черновика в координатах канваса. */
  bounds: Rect
}

/**
 * Публичная ручка протяжки для Canvas. Плоский объект с методами — Canvas
 * ничего не знает про ref и состояние внутри хука.
 */
export interface ShapeDrawController {
  /** Вид фигуры в процессе протяжки — по нему рисуется предпросмотр. */
  kind: ShapeKind | null
  /** Габариты черновика в координатах канваса; null — протяжки нет. */
  bounds: Rect | null
  /** Начать протяжку: экранная точка + камера. */
  begin: (kind: ShapeKind, point: ScreenPoint, viewport: Viewport) => void
  /** Продвинуть протяжку новой экранной точкой. */
  update: (point: ScreenPoint, viewport: Viewport) => void
  /** Зафиксировать фигуру. Вернёт её id либо null, если фигуру создавать нельзя. */
  commit: () => string | null
  /** Бросить протяжку, ничего не создавая (Escape, уход в другое окно). */
  cancel: () => void
}

/**
 * Незавершённое перетаскивание. Тоже ref, а не состояние: стартовые габариты
 * и накопленное смещение читаются синхронно, и внутри setState-функции в
 * StrictMode обновление не должно выполняться дважды.
 */
interface ShapeMove {
  /**
   * Габариты каждой перетаскиваемой фигуры ДО жеста — источник истины.
   *
   * Смещение всегда применяется к ним, а не к текущим bounds: иначе каждый
   * кадр прибавлял бы шаг к уже сдвинутой фигуре и мелкая ошибка сложения
   * копилась бы всю дорогу до отпускания кнопки.
   */
  origins: ReadonlyMap<string, Rect>
  /** Накопленное смещение в координатах канваса. */
  offset: Point
  /** Последняя экранная точка — из неё считается шаг смещения. */
  lastScreen: ScreenPoint
  /**
   * Документ и выделение ДО жеста. Именно этот снимок уходит в историю при
   * commit: перетаскивание меняет фигуры на каждом кадре, но отменяется как
   * одно действие, а не как сотня.
   */
  before: HistorySnapshot
  /** Смещение уже применяли хотя бы раз: клик без движения историю не трогает. */
  moved: boolean
}

/**
 * Снимок состояния, к которому можно вернуться.
 *
 * Выделение — часть снимка: отменив перемещение, пользователь ожидает увидеть
 * фигуру снова выделенной, а не просто вернуть её на прежнее место.
 */
interface HistorySnapshot {
  readonly shapes: readonly Shape[]
  readonly selectedIds: readonly string[]
}

/** Что интерфейсу нужно знать про историю: есть что отменить и есть что вернуть. */
interface HistoryFlags {
  readonly canUndo: boolean
  readonly canRedo: boolean
}

/** Пустое начало истории: до первого изменения отменять нечего. */
const EMPTY_HISTORY: HistoryFlags = { canUndo: false, canRedo: false }

/**
 * Подпись правки: какая фигура и какие поля.
 *
 * Пикер цвета в панели свойств шлёт onChange на каждом кадре перетаскивания, и
 * без подписи одна правка цвета превратилась бы в десятки записей истории.
 * Соседние правки одного поля одной фигуры — одна запись.
 */
function editSignature(id: string, patch: ShapePatch): string {
  return `${id}:${Object.keys(patch).sort().join(',')}`
}

/** Как начинается жест выделения: обычный клик или добавление к выделению. */
export interface ShapeMoveOptions {
  /** Shift / Ctrl / Cmd: не снимать прежнее выделение, а переключить фигуру в нём. */
  additive?: boolean
}

/**
 * Публичная ручка перетаскивания для Canvas. Устроена как draw: тот же
 * жизненный цикл, тот же обмен «экранная точка + камера на входе».
 */
export interface ShapeMoveController {
  /** Фигура под курсором — верхняя видимая и незаблокированная; null — пусто. */
  hitTest: (point: ScreenPoint, viewport: Viewport) => string | null
  /** id фигуры, которую сейчас тянут; null — жеста нет. */
  draggingId: string | null
  /**
   * Клик по фигуре: выделить её и начать перетаскивание. Вернёт её id либо
   * null, если под курсором пусто — тогда жест не начинается, а клик по
   * фону снимет выделение.
   */
  begin: (point: ScreenPoint, viewport: Viewport, options?: ShapeMoveOptions) => string | null
  /** Продвинуть перетаскивание новой экранной точкой. */
  update: (point: ScreenPoint, viewport: Viewport) => void
  /** Оставить фигуру там, куда её донесли. */
  commit: () => void
  /** Вернуть фигуру на исходное место (Escape, уход в другое окно). */
  cancel: () => void
}

/**
 * Точка вставки картинки.
 *
 * Устроена как вход ручек draw/move: экранные пиксели и камера, а перевод в
 * координаты канваса делает хук — поэтому Canvas ничего не считает сам.
 * Отдельного случая «вставь в центр» здесь нет: под центр подставляется
 * центр видимой области, и правило координат работает одно на оба пути.
 */
export interface ImageAnchor {
  /** Точка в экранных пикселях относительно левого верхнего угла холста. */
  point: ScreenPoint
  /** Камера на момент вставки. */
  viewport: Viewport
}

export interface UseShapesResult {
  /** Все фигуры в порядке отрисовки: первая — снизу. */
  shapes: readonly Shape[]
  /** Идентификаторы выделенных фигур. */
  selectedIds: readonly string[]
  /** Последняя выделенная фигура — её показывает панель свойств. */
  selectedShape: Shape | null
  /** Создать фигуру с указанными габаритами и выделить её. Возвращает id. */
  addShape: (kind: ShapeKind, bounds: Rect) => string
  /**
   * Вставить картинки из файлов — из буфера обмена (Ctrl+V) или перетаскивания.
   * Возвращает управление сразу: декодирование файлов асинхронное, поэтому
   * фигуры появляются позже.
   */
  insertImages: (files: readonly File[], anchor: ImageAnchor) => void
  /** Удалить выделенные фигуры — Delete или Backspace. */
  deleteSelected: () => void
  /** Точечно изменить фигуру: цвет, имя, габариты. */
  updateShape: (id: string, patch: ShapePatch) => void
  /** Выделить одну фигуру (снимая прежнее выделение). */
  selectShape: (id: string) => void
  /** Задать выделение целиком. */
  setSelection: (ids: readonly string[]) => void
  /** Добавить или снять фигуру из выделения — для Shift+клика. */
  toggleSelection: (id: string) => void
  /** Снять всё выделение. */
  clearSelection: () => void
  /** Выделена ли фигура — для подсветки рамки в Shape.tsx. */
  isSelected: (id: string) => boolean
  /** Отменить последнее изменение документа (Ctrl+Z). */
  undo: () => void
  /** Вернуть отменённое (Ctrl+Shift+Z). */
  redo: () => void
  /** Есть что отменять — для кнопок и подсказок. */
  canUndo: boolean
  /** Есть что вернуть — для кнопок и подсказок. */
  canRedo: boolean
  /** Протяжка новой фигуры: предпросмотр и её создание. */
  draw: ShapeDrawController
  /** Клик по фигуре и перетаскивание выделенного. */
  move: ShapeMoveController
}

/** Идентификаторы локальные и предсказуемые: никакой зависимости от crypto. */
let shapeSequence = 0
function createShapeId(): string {
  shapeSequence += 1
  return `shape_${shapeSequence}`
}

export function useShapes(): UseShapesResult {
  const [shapes, setShapes] = useState<readonly Shape[]>([])
  const [selectedIds, setSelectedIds] = useState<readonly string[]>([])

  // Протяжка: ref — источник истины для commit, состояние — только для картинки.
  const draftRef = useRef<ShapeDraft | null>(null)
  const [draftPreview, setDraftPreview] = useState<ShapeDraft | null>(null)

  // Перетаскивание: ref — источник истины, состояние хранит только id фигуры
  // под курсором, по которому меняется курсор и работает Escape.
  const moveRef = useRef<ShapeMove | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)

  /* ── История изменений ──────────────────────────────────────────────────── */

  const pastRef = useRef<readonly HistorySnapshot[]>([])
  const futureRef = useRef<readonly HistorySnapshot[]>([])
  /** Сами стеки — ref'ы: они меняются без перерисовки, интерфейсу нужны флаги. */
  const [historyFlags, setHistoryFlags] = useState<HistoryFlags>(EMPTY_HISTORY)
  /** Подпись последней правки того же поля — признак продолжения серии правок. */
  const lastEditRef = useRef<string | null>(null)

  /**
   * object URL всех вставленных картинок.
   *
   * Освобождать их по одной нельзя: Ctrl+Z и redo достают фигуру из истории
   * вместе с её адресом, и после revoke картинка осталась бы битой, хотя
   * отмена обещала вернуть её. Поэтому единственное безопасное место для
   * revoke — размонтирование хука, когда история уже не нужна.
   */
  const objectUrlsRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    const objectUrls = objectUrlsRef.current
    return () => {
      for (const url of objectUrls) URL.revokeObjectURL(url)
      objectUrls.clear()
    }
  }, [])

  /**
   * Зеркало текущего состояния: оно и есть «до изменения».
   *
   * Читать состояние из замыкания useCallback нельзя: обработчик приходит из
   * подписки на keydown, которая переподключается редко, и видел бы состояние
   * на момент подписки. Зеркало обновляется в useLayoutEffect — то есть сразу
   * после фиксации рендера и до того, как сработает любое событие, поэтому
   * снимок всегда свежий.
   *
   * Именно ref, а не setState-функция: обновление внутри setState в StrictMode
   * выполняется дважды, и в стек попали бы две одинаковые записи истории.
   */
  const latestRef = useRef<HistorySnapshot>({ shapes: [], selectedIds: [] })
  useLayoutEffect(() => {
    latestRef.current = { shapes, selectedIds }
  })

  const syncHistoryFlags = useCallback(() => {
    const next: HistoryFlags = {
      canUndo: pastRef.current.length > 0,
      canRedo: futureRef.current.length > 0,
    }
    // Возвращаем prev, если ничего не изменилось: лишний рендер на каждый
    // кадр протяжки (движения записываются в состояние) не нужен.
    setHistoryFlags((prev) =>
      prev.canUndo === next.canUndo && prev.canRedo === next.canRedo ? prev : next,
    )
  }, [])

  /** Записать состояние ДО изменения. Новое изменение обнуляет redo. */
  const pushPast = useCallback(
    (before: HistorySnapshot) => {
      pastRef.current = [...pastRef.current, before].slice(-HISTORY_LIMIT)
      futureRef.current = []
      // Любая записанная правка закрывает серию: следующая правка того же поля
      // начнёт новую запись с состояния, которое сложилось только что.
      lastEditRef.current = null
      syncHistoryFlags()
    },
    [syncHistoryFlags],
  )

  const undo = useCallback(() => {
    lastEditRef.current = null

    const previous = pastRef.current[pastRef.current.length - 1]
    if (!previous) return

    pastRef.current = pastRef.current.slice(0, -1)
    futureRef.current = [...futureRef.current, latestRef.current]
    setShapes(previous.shapes)
    setSelectedIds(previous.selectedIds)
    syncHistoryFlags()
  }, [syncHistoryFlags])

  const redo = useCallback(() => {
    lastEditRef.current = null

    const next = futureRef.current[futureRef.current.length - 1]
    if (!next) return

    futureRef.current = futureRef.current.slice(0, -1)
    pastRef.current = [...pastRef.current, latestRef.current].slice(-HISTORY_LIMIT)
    setShapes(next.shapes)
    setSelectedIds(next.selectedIds)
    syncHistoryFlags()
  }, [syncHistoryFlags])

  const addShape = useCallback(
    (kind: ShapeKind, bounds: Rect): string => {
      const id = createShapeId()
      const shape: VectorShape = {
        id,
        kind,
        name: `${SHAPE_LABELS[kind]} ${shapeSequence}`,
        bounds,
        fill: DEFAULT_FILL,
        stroke: DEFAULT_STROKE,
        strokeWidth: DEFAULT_STROKE_WIDTH,
        visible: true,
        locked: false,
      }

      pushPast(latestRef.current)

      // Новая фигура всегда сверху стека и сразу выделена — так ведут себя все
      // графические редакторы.
      setShapes((prev) => [...prev, shape])
      setSelectedIds([id])

      return id
    },
    [pushPast],
  )

  /**
   * Поставить картинку на холст: центром в указанную точку, в её собственных
   * пропорциях, и сразу выделить — как любая новая фигура.
   *
   * Габариты уменьшаются пропорционально, но не увеличиваются: иначе картинка
   * 32×32 растянулась бы в размытое пятно, а фотография на 4000 пикселей —
   * закрыла холст целиком (MAX_IMAGE_EDGE_PX).
   */
  const addImageShape = useCallback(
    (image: LoadedImage, anchor: ImageAnchor): string => {
      const id = createShapeId()

      const scale = Math.min(1, MAX_IMAGE_EDGE_PX / Math.max(image.width, image.height))
      const width = image.width * scale
      const height = image.height * scale
      const center = screenToCanvas(anchor.point, anchor.viewport)

      const shape: ImageShape = {
        id,
        kind: 'image',
        name: `${SHAPE_LABELS.image} ${shapeSequence}`,
        // Картинка центрируется в точке вставки: так она появляется ровно под
        // курсором (дроп) или в центре холста (Ctrl+V), а не левым верхним углом.
        bounds: { x: center.x - width / 2, y: center.y - height / 2, width, height },
        src: image.src,
        width: image.width,
        height: image.height,
        visible: true,
        locked: false,
      }

      pushPast(latestRef.current)

      setShapes((prev) => [...prev, shape])
      setSelectedIds([id])

      return id
    },
    [pushPast],
  )

  /**
   * Вставить картинки из файлов — Ctrl+V или перетаскивание из проводника.
   *
   * Размер картинки известен только после декодирования файла браузером, а
   * декодирование асинхронное: поэтому фигура появляется на кадр позже, чем
   * пришло событие. Отсюда и «неблокирующая» подпись — вызывающий не ждёт.
   *
   * Снимок «до» берётся в момент создания фигуры, а не в момент события:
   * пока файл читается, пользователь вправе нарисовать ещё что-то.
   */
  const insertImages = useCallback(
    (files: readonly File[], anchor: ImageAnchor): void => {
      void Promise.allSettled(files.map((file) => readImageFile(file))).then((results) => {
        for (const result of results) {
          if (result.status === 'rejected') {
            // Один нечитаемый файл не должен отменять вставку остальных.
            console.warn('[mini-figma] картинка пропущена:', result.reason)
            continue
          }
          // URL переживает историю: Ctrl+Z достаёт фигуру вместе с её адресом.
          // Освобождать адрес можно только всем сразу при размонтировании.
          objectUrlsRef.current.add(result.value.src)
          addImageShape(result.value, anchor)
        }
      })
    },
    [addImageShape],
  )

  /** Удалить выделенное. Картинка — та же запись в shapes, поэтому и она. */
  const deleteSelected = useCallback(() => {
    if (selectedIds.length === 0) return

    const doomed = new Set(selectedIds)

    pushPast(latestRef.current)
    setShapes((prev) => prev.filter((shape) => !doomed.has(shape.id)))
    setSelectedIds([])
  }, [pushPast, selectedIds])

  const updateShape = useCallback(
    (id: string, patch: ShapePatch) => {
      // Продолжение серии правок (перетаскивание пикера цвета): запись уже
      // есть, и «до» у неё то же самое — до первой правки этой серии.
      const signature = editSignature(id, patch)
      if (signature !== lastEditRef.current) pushPast(latestRef.current)
      lastEditRef.current = signature

      setShapes((prev) => prev.map((shape) => (shape.id === id ? { ...shape, ...patch } : shape)))
    },
    [pushPast],
  )

  const selectShape = useCallback((id: string) => {
    lastEditRef.current = null
    setSelectedIds([id])
  }, [])

  const setSelection = useCallback((ids: readonly string[]) => {
    lastEditRef.current = null
    setSelectedIds(ids)
  }, [])

  const toggleSelection = useCallback((id: string) => {
    lastEditRef.current = null
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((each) => each !== id) : [...prev, id]))
  }, [])

  const clearSelection = useCallback(() => setSelectedIds([]), [])

  const isSelected = useCallback((id: string) => selectedIds.includes(id), [selectedIds])

  /* ── Протяжка ──────────────────────────────────────────────────────────── */

  const beginShapeDraw = useCallback(
    (kind: ShapeKind, point: ScreenPoint, viewport: Viewport) => {
      const start = screenToCanvas(point, viewport)
      const draft: ShapeDraft = {
        kind,
        start,
        startScreen: point,
        lastScreen: point,
        bounds: { x: start.x, y: start.y, width: 0, height: 0 },
      }
      draftRef.current = draft
      setDraftPreview(draft)
    },
    [],
  )

  const updateShapeDraw = useCallback((point: ScreenPoint, viewport: Viewport) => {
    const draft = draftRef.current
    if (!draft) return

    const next: ShapeDraft = {
      ...draft,
      lastScreen: point,
      // rectFromPoints нормализует протяжку вверх/влево: width/height всегда ≥ 0.
      bounds: rectFromPoints(draft.start, screenToCanvas(point, viewport)),
    }
    draftRef.current = next
    setDraftPreview(next)
  }, [])

  const commitShapeDraw = useCallback((): string | null => {
    const draft = draftRef.current

    // Чистим состояние до проверок — отменённый черновик не должен пережить
    // ни щелчок, ни отказ по размеру.
    draftRef.current = null
    setDraftPreview(null)

    if (!draft) return null

    // Щелчок без протяжки — опечатка, а не фигура нулевого размера. Меряем в
    // экранных пикселях, иначе на мелком зуме фильтр почти не работал бы.
    const dragged = Math.hypot(
      draft.lastScreen.x - draft.startScreen.x,
      draft.lastScreen.y - draft.startScreen.y,
    )
    if (dragged < MIN_DRAG_SCREEN_PX) return null
    if (!isRectVisible(draft.bounds)) return null

    return addShape(draft.kind, draft.bounds)
  }, [addShape])

  const cancelShapeDraw = useCallback(() => {
    draftRef.current = null
    setDraftPreview(null)
  }, [])

  const draw = useMemo<ShapeDrawController>(
    () => ({
      kind: draftPreview?.kind ?? null,
      bounds: draftPreview?.bounds ?? null,
      begin: beginShapeDraw,
      update: updateShapeDraw,
      commit: commitShapeDraw,
      cancel: cancelShapeDraw,
    }),
    [draftPreview, beginShapeDraw, updateShapeDraw, commitShapeDraw, cancelShapeDraw],
  )

  /* ── Перетаскивание ────────────────────────────────────────────────────── */

  const hitTestAtScreen = useCallback(
    (point: ScreenPoint, viewport: Viewport): string | null =>
      hitTestShape(screenToCanvas(point, viewport), shapes)?.id ?? null,
    [shapes],
  )

  const beginShapeMove = useCallback(
    (point: ScreenPoint, viewport: Viewport, options: ShapeMoveOptions = {}): string | null => {
      // Хит-тест по всем фигурам: Shift+кликом добавляют вторую фигуру к уже
      // выделенным, поэтому кликать приходится поверх уже выбранной.
      const target = hitTestShape(screenToCanvas(point, viewport), shapes)
      if (!target) return null

      const wasSelected = selectedIds.includes(target.id)

      // Политика выделения живёт здесь, а не в Canvas: состояние одно, и
      // разводить его по компонентам — значит разрешить им расходиться.
      if (options.additive) toggleSelection(target.id)
      else setSelection([target.id])

      // Тянем всю группу выделения, а ту фигуру, которую клик только что
      // снял из выделения, — нет: на экране её уже нет.
      const groupIds = options.additive
        ? wasSelected
          ? selectedIds.filter((id) => id !== target.id)
          : [...selectedIds, target.id]
        : [target.id]

      const byId = new Map(shapes.map((shape) => [shape.id, shape]))
      const origins = new Map<string, Rect>()
      for (const id of groupIds) {
        const shape = byId.get(id)
        if (!shape || shape.locked || !shape.visible) continue
        origins.set(id, shape.bounds)
      }
      // Выделение есть, а двигать нечего (сняли последнюю фигуру, либо всё
      // выделение заблокировано) — жест не начинаем вовсе.
      if (origins.size === 0) return null

      moveRef.current = {
        origins,
        offset: { x: 0, y: 0 },
        lastScreen: point,
        before: latestRef.current,
        moved: false,
      }
      setDraggingId(target.id)

      return target.id
    },
    [shapes, selectedIds, setSelection, toggleSelection],
  )

  const updateShapeMove = useCallback((point: ScreenPoint, viewport: Viewport) => {
    const move = moveRef.current
    if (!move) return

    // Шаг жеста берём в экранных пикселях и переводим делением на зум: так
    // фигура идёт ровно под курсором при любом масштабе. Если зум поедет
    // посреди перетаскивания, шаг пересчитается по нему же.
    const step = screenDeltaToCanvas(
      { x: point.x - move.lastScreen.x, y: point.y - move.lastScreen.y },
      viewport,
    )

    // Точка не сдвинулась — пересобирать фигуры незачем: события pointermove
    // идут пачками, и без этой проверки пустой шаг гонял бы перерисовку.
    if (step.x === 0 && step.y === 0) return

    const offset = { x: move.offset.x + step.x, y: move.offset.y + step.y }

    const next: ShapeMove = { ...move, offset, lastScreen: point, moved: true }
    moveRef.current = next

    // Габариты всегда собираются заново из стартовых (ShapeMove.origins) —
    // поэтому промахнуться мимо фигуры, которая «уехала» под курсором, невозможно.
    setShapes((prev) => translateShapes(prev, next.origins, offset))
  }, [])

  const commitShapeMove = useCallback(() => {
    const move = moveRef.current
    moveRef.current = null
    setDraggingId(null)

    // Клик без смещения ничего не менял — записывать в историю нечего.
    if (!move || !move.moved) return

    pushPast(move.before)
  }, [pushPast])

  const cancelShapeMove = useCallback(() => {
    // Чистим состояние до чтения — отменённый жест не должен пережить
    // ни Escape, ни уход в другое окно.
    const move = moveRef.current
    moveRef.current = null
    setDraggingId(null)
    if (!move) return

    // Нулевая дельта — это и есть возврат на стартовые габариты.
    setShapes((prev) => translateShapes(prev, move.origins, { x: 0, y: 0 }))
  }, [])

  const move = useMemo<ShapeMoveController>(
    () => ({
      hitTest: hitTestAtScreen,
      draggingId,
      begin: beginShapeMove,
      update: updateShapeMove,
      commit: commitShapeMove,
      cancel: cancelShapeMove,
    }),
    [hitTestAtScreen, draggingId, beginShapeMove, updateShapeMove, commitShapeMove, cancelShapeMove],
  )

  const selectedShape = useMemo(() => {
    const lastId = selectedIds[selectedIds.length - 1]
    if (!lastId) return null
    return shapes.find((shape) => shape.id === lastId) ?? null
  }, [shapes, selectedIds])

  return {
    shapes,
    selectedIds,
    selectedShape,
    addShape,
    updateShape,
    selectShape,
    setSelection,
    toggleSelection,
    clearSelection,
    isSelected,
    undo,
    redo,
    canUndo: historyFlags.canUndo,
    canRedo: historyFlags.canRedo,
    insertImages,
    deleteSelected,
    draw,
    move,
  }
}