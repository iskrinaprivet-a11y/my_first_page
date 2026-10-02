/**
 * ХОЛСТ. Единственная зона экрана, которая работает с мышью.
 *
 * Что уже работает на этом шаге:
 *  — сетка на фоне, ездящая вместе с камерой;
 *  — панорамирование: зажать ПРОБЕЛ и тянуть мышью;
 *  — зум колесом от 10% до 400% с фиксацией точки под курсором;
 *  — центрирование холста при старте;
 *  — рисование прямоугольника и эллипса протяжкой мыши;
 *  — выделение фигуры кликом (рамка с маркерами) и перетаскивание выделения;
 *  — вставка картинок: Ctrl+V из буфера обмена и перетаскивание файлов из
 *    проводника (файл встаёт под курсором, Ctrl+V — в центр холста);
 *  — подсказки по клавишам внизу (панорама, зум, undo/redo).
 *
 * Canvas ничего не хранит про фигуры: список, выделение, протяжка,
 * перетаскивание и вставка картинок приходят props'ами из App (единственный
 * владелец useShapes), а пересчёт координат — из useViewport и
 * utils/geometry. Здесь только события: ни хит-теста, ни пересчёта габаритов,
 * ни политики выделения. Единственное, что Canvas знает про картинки, — где
 * стоит их вставить: точка приходит из события, а экранные пиксели на входе
 * так же, как у мышиных ручек draw и move.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type {
  CSSProperties,
  DragEvent as ReactDragEvent,
  PointerEvent as ReactPointerEvent,
} from 'react'

import { isDrawTool, REDO_HINT, UNDO_HINT } from '../constants/tools'
import { DATA_TRANSFER_FILES, INSERT_IMAGE_HINT } from '../constants/images'
import { useViewport } from '../hooks/useViewport'
import type { ImageAnchor, ShapeDrawController, ShapeMoveController } from '../hooks/useShapes'
import { isTypingTarget } from '../hooks/useHotkeys'
import { imageFilesFromDataTransfer } from '../utils/images'
import {
  DEFAULT_FILL,
  DEFAULT_STROKE,
  DEFAULT_STROKE_WIDTH,
  GRID_MAJOR_EVERY,
  GRID_SIZE,
  MAX_ZOOM,
  MIN_ZOOM,
  PINCH_ZOOM_SENSITIVITY,
  WHEEL_ZOOM_SENSITIVITY,
  ZOOM_STEP,
} from '../constants/viewport'
import type { ScreenPoint, Shape, Size, Tool } from '../types/shape'
import ShapeView from './Shape'

/** Цвета линий сетки. На CSS-переменных не тянем — это локальная деталь холста. */
const MINOR_LINE = 'rgba(255, 255, 255, 0.055)'
const MAJOR_LINE = 'rgba(255, 255, 255, 0.1)'
/** Ниже этого размера ячейки мелкая сетка сливается в кашу — отключаем её. */
const MINOR_GRID_MIN_PX = 8

/**
 * Что сейчас делает зажатая левая кнопка на холсте. Одно поле вместо трёх
 * отдельных ref'ов: пан, протяжку и перетаскивание нельзя начать одновременно,
 * а «какой из жестов активен» — это ровно одно значение.
 */
type SurfaceGesture =
  | { mode: 'none' }
  /** Панорама (пробел). Храним последнюю позицию мыши в экранных пикселях. */
  | { mode: 'pan'; pointerId: number; x: number; y: number }
  /** Протяжка новой фигуры. Габариты считает useShapes, здесь только факт старта. */
  | { mode: 'draw'; pointerId: number }
  /** Перетаскивание выделенной фигуры. Смещение считает useShapes. */
  | { mode: 'move'; pointerId: number }

export interface CanvasProps {
  /** Активный инструмент: рисуем протяжкой или выделяем. */
  activeTool: Tool
  /** Все фигуры в порядке отрисовки: первая — снизу. */
  shapes: readonly Shape[]
  /** Выделена ли фигура — подсветка рамкой. */
  isSelected: (id: string) => boolean
  /** Снять выделение по клику на пустое место. */
  clearSelection: () => void
  /** Протяжка новой фигуры: предпросмотр и создание. */
  draw: ShapeDrawController
  /** Хит-тест, выделение кликом и перетаскивание. */
  move: ShapeMoveController
  /**
   * Вставить картинки из файлов: Ctrl+V или перетаскивание в холст.
   * Точка приходит экранными пикселями вместе с камерой — ровно как у мышиных
   * ручек, поэтому пересчитывать координаты здесь не нужно.
   */
  onInsertImages: (files: readonly File[], anchor: ImageAnchor) => void
}

export default function Canvas({
  activeTool,
  shapes,
  isSelected,
  clearSelection,
  draw,
  move,
  onInsertImages,
}: CanvasProps) {
  const { viewport, zoomPercent, isPanning, startPan, endPan, panBy, zoomBy, centerView } =
    useViewport()

  const surfaceRef = useRef<HTMLDivElement | null>(null)
  const [spacePressed, setSpacePressed] = useState(false)
  const hasCenteredRef = useRef(false)
  /** Текущий жест на поверхности: панорама, протяжка, перетаскивание или ничего. */
  const gestureRef = useRef<SurfaceGesture>({ mode: 'none' })
  /**
   * После протяжки и после перетаскивания браузер досылает click. Без этого
   * флага он попал бы в onBackgroundClick и снял бы выделение у только что
   * созданной или только что передвинутой фигуры.
   */
  const skipNextClickRef = useRef(false)
  /**
   * Именно метод, а не объект draw/move: оба пересобираются на каждом кадре
   * протяжки или перетаскивания, и зависимость от них переподключала бы
   * слушатели на каждом движении мыши. Сами cancel — useCallback с пустым
   * списком зависимостей, поэтому стабильны и оборачивать их в ref не нужно.
   */
  const cancelDraw = draw.cancel
  const cancelMove = move.cancel

  /**
   * Фигура под курсором — нужна только для курсора «двигать». Живёт и в ref,
   * и в состоянии: ref не даёт вызывать setState на каждом кадре движения
   * мыши, а состояние нужно, чтобы курсор перерисовался.
   */
  const hoverIdRef = useRef<string | null>(null)
  const [hoveredId, setHoveredId] = useState<string | null>(null)

  /**
   * Свежие onInsertImages и камера для обработчиков вставки картинок.
   *
   * Подписываться на них нельзя: камера меняется на каждом кадре зума или
   * панорамы, и слушатель переподключался бы непрерывно. Зеркало — как в
   * useHotkeys: обновляется в useLayoutEffect, то есть к моменту любого
   * события в нём лежит последний отрендеренный кадр.
   */
  const insertionRef = useRef({ insert: onInsertImages, viewport })
  useLayoutEffect(() => {
    insertionRef.current = { insert: onInsertImages, viewport }
  })

  /** Поверх холста тянут файл из проводника — показываем, что его можно отпустить здесь. */
  const [isFileDragOver, setIsFileDragOver] = useState(false)
  /**
   * Счётчик вложенных dragenter / dragleave.
   *
   * Браузер шлёт пару на каждый элемент, над которым проходит указатель, так
   * что считать события — единственный способ не погасить подсветку, когда
   * указатель пересекает дочерний узел холста. Обнуляется на drop: перенос
   * завершается один раз.
   */
  const fileDragDepthRef = useRef(0)

  /**
   * Поверхность ввода цепляется через callback-ref: он вызывается сразу после
   * монтирования, когда размеры уже можно измерить. Отсюда же — одноразовое
   * центрирование холста.
   *
   * Важно: здесь НЕ нужен ResizeObserver. Он срабатывает асинхронно, только
   * после кадра отрисовки, поэтому хост без цикла отрисовки (headless, вкладка
   * в фоне, встроенный webview) показал бы холст нецентрированным навсегда.
   * Прямое чтение getBoundingClientRect() не зависит ни от кадров, ни от
   * отрисовки — синхронное измерение всегда даёт готовый layout.
   *
   * Пере-центрировать при изменении размера окна не нужно: как и в редакторах,
   * вид сохраняется, а не прыгает.
   */
  const attachSurface = useCallback(
    (node: HTMLDivElement | null) => {
      surfaceRef.current = node
      if (!node || hasCenteredRef.current) return

      const rect = node.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) return

      hasCenteredRef.current = true
      centerView({ width: rect.width, height: rect.height })
    },
    [centerView],
  )

  /** Габариты канваса по факту — нужны кнопкам зума, которые тянутся к центру. */
  function canvasSize(): Size {
    const rect = surfaceRef.current?.getBoundingClientRect()
    return { width: rect?.width ?? 0, height: rect?.height ?? 0 }
  }

  // Пробел держит камеру «в руке». Событие слушаем на window: фокус может быть
  // на панели, а нажатие мы всё равно должно работать.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.code !== 'Space' || isTypingTarget(event.target)) return
      event.preventDefault()
      setSpacePressed(true)
    }

    function onKeyUp(event: KeyboardEvent) {
      if (event.code === 'Space') setSpacePressed(false)
    }

    // Уход в другое окно не должен оставлять «залипший» пробел,
    // незавершённую фигуру или наполовину передвинутую.
    function onWindowBlur() {
      setSpacePressed(false)
      gestureRef.current = { mode: 'none' }
      endPan()
      cancelDraw()
      cancelMove()
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onWindowBlur)

    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onWindowBlur)
    }
    // Зависимость от методов отмены (а не от объектов draw/move) — см. выше.
  }, [endPan, cancelDraw, cancelMove])

  // Колесо: нативный слушатель с passive:false — иначе preventDefault не работает
  // и браузер скроллит страницу вместо зума.
  useEffect(() => {
    const element = surfaceRef.current
    if (!element) return

    function onWheel(event: WheelEvent) {
      event.preventDefault()

      // Во время диспатча currentTarget — ровно тот элемент, на котором
      // повешен слушатель. Проверка instead of `as` — чтобы strict-режим
      // оставался строгим.
      const surface = event.currentTarget
      if (!(surface instanceof HTMLElement)) return

      const rect = surface.getBoundingClientRect()
      // Точка под курсором в координатах самого холста.
      const anchor: ScreenPoint = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      }
      const sensitivity = event.ctrlKey ? PINCH_ZOOM_SENSITIVITY : WHEEL_ZOOM_SENSITIVITY

      // Именно множитель, а не абсолютный зум: useViewport умножает zoom
      // внутри setState от свежего значения. Если считать зум здесь, из
      // viewport.zoom в замыкании, то несколько колесок подряд (трекпад,
      // быстрая прокрутка) возьмут устаревшее значение и часть событий
      // потеряется — зум «отстанет» от руки.
      zoomBy(Math.exp(-event.deltaY * sensitivity), anchor)
    }

    element.addEventListener('wheel', onWheel, { passive: false })
    return () => element.removeEventListener('wheel', onWheel)
  }, [zoomBy])

  /**
   * Ctrl+V — вставка картинки из буфера обмена.
   *
   * Слушатель на window, а не на холсте: фокус может стоять на пикере цвета в
   * панели свойств, и вставка должна работать оттуда. Сами поля вставки мы не
   * перехватываем (isTypingTarget) — вставка текста в <input> остаётся обычной.
   *
   * Точка вставки — центр видимой области: тот же экранный формат, что у мыши,
   * поэтому перевод в координаты канваса делает useShapes. Картинка встаёт
   * центром в эту точку, а не углом.
   */
  useEffect(() => {
    function onPaste(event: ClipboardEvent) {
      if (isTypingTarget(event.target)) return

      const files = imageFilesFromDataTransfer(event.clipboardData)
      // В буфере обычный текст: не гасим умолчание, пусть он вставится как есть.
      if (files.length === 0) return

      // Гасим умолчание: иначе браузер попробует вставить картинку в страницу.
      event.preventDefault()

      const size = canvasSize()
      const { insert, viewport: currentViewport } = insertionRef.current
      insert(files, {
        point: { x: size.width / 2, y: size.height / 2 },
        viewport: currentViewport,
      })
    }

    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
    // Подписка одна на всё время жизни холста: свежие onInsertImages и камера
    // берутся из insertionRef (см. выше), а canvasSize читает ref, а не замыкание.
  }, [])

  /**
   * Тянет ли пользователь файл, а не текст. Браузер сообщает об этом типами в
   * dataTransfer: «Files» есть только у переноса из проводника.
   */
  function carriesFiles(event: ReactDragEvent<HTMLDivElement>): boolean {
    return Array.from(event.dataTransfer.types).includes(DATA_TRANSFER_FILES)
  }

  function onDragEnter(event: ReactDragEvent<HTMLDivElement>) {
    if (!carriesFiles(event)) return
    // Без preventDefault браузер не считает узел целью переноса.
    event.preventDefault()
    fileDragDepthRef.current += 1
    setIsFileDragOver(true)
  }

  function onDragOver(event: ReactDragEvent<HTMLDivElement>) {
    if (!carriesFiles(event)) return
    // Главный preventDefault вставки: без него дроп не сработает вовсе, браузер
    // покажет курсор «нельзя» и продолжит искать цель переноса.
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }

  function onDragLeave() {
    // Типы из dataTransfer здесь читать не на что: событие приходит уже на
    // уход, поэтому просто уменьшаем счётчик вложенных входов.
    if (fileDragDepthRef.current === 0) return

    fileDragDepthRef.current -= 1
    if (fileDragDepthRef.current === 0) setIsFileDragOver(false)
  }

  function onDrop(event: ReactDragEvent<HTMLDivElement>) {
    // Обязательный preventDefault: без него браузер откроет файл в новой
    // вкладке и уйдёт со страницы вместе с несохранённой работой.
    event.preventDefault()
    fileDragDepthRef.current = 0
    setIsFileDragOver(false)

    const files = imageFilesFromDataTransfer(event.dataTransfer)
    if (files.length === 0) return

    const { insert, viewport: currentViewport } = insertionRef.current
    insert(files, { point: screenPointOf(event), viewport: currentViewport })
  }

  /**
   * Захват указателя позволяет тянуть мышью за пределы холста, но он
   * необязателен: если браузер его не дал, протяжка всё равно идёт.
   * Поэтому состояние протяжки на него не завязываем.
   */
  function setCaptured(pointerId: number, shouldCapture: boolean) {
    const element = surfaceRef.current
    if (!element) return

    try {
      if (shouldCapture) element.setPointerCapture(pointerId)
      else if (element.hasPointerCapture(pointerId)) element.releasePointerCapture(pointerId)
    } catch {
      return // нет захвата — не беда, события приходят на холст как есть
    }
  }

  /**
 * Экранные координаты указателя относительно левого верхнего угла холста.
 *
 * Параметр описан структурно, а не как ReactPointerEvent: ту же функцию читает
 * и drop-событие, у которого свой тип, а полей нужно ровно два.
 */
function screenPointOf(event: { clientX: number; clientY: number }): ScreenPoint {
    const rect = surfaceRef.current?.getBoundingClientRect()
    return {
      x: event.clientX - (rect?.left ?? 0),
      y: event.clientY - (rect?.top ?? 0),
    }
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    // Пробел всегда важнее активного инструмента — как в редакторах.
    if (spacePressed) {
      event.preventDefault()
      gestureRef.current = {
        mode: 'pan',
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
      }
      startPan()
      setCaptured(event.pointerId, true)
      return
    }

    if (isDrawTool(activeTool)) {
      event.preventDefault()
      gestureRef.current = { mode: 'draw', pointerId: event.pointerId }
      // Захват держит протяжку, когда курсор ушёл за пределы холста.
      setCaptured(event.pointerId, true)
      draw.begin(activeTool, screenPointOf(event), viewport)
      return
    }

    // Инструмент выделения. begin сам ищет фигуру под курсором, выделяет её и
    // стартует перетаскивание; null — под курсором пусто, и клик по фону
    // снимет выделение. Навигацию по выделению — Shift+Ctrl.
    const hitId = move.begin(screenPointOf(event), viewport, {
      additive: event.shiftKey || event.ctrlKey || event.metaKey,
    })
    if (!hitId) return

    event.preventDefault()
    gestureRef.current = { mode: 'move', pointerId: event.pointerId }
    setCaptured(event.pointerId, true)
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const gesture = gestureRef.current

    if (gesture.mode !== 'none' && gesture.pointerId === event.pointerId) {
      if (gesture.mode === 'pan') {
        panBy({ x: event.clientX - gesture.x, y: event.clientY - gesture.y })
        gestureRef.current = { ...gesture, x: event.clientX, y: event.clientY }
      } else if (gesture.mode === 'move') {
        move.update(screenPointOf(event), viewport)
      } else {
        draw.update(screenPointOf(event), viewport)
      }
      return
    }

    // Жеста нет — курсор подсказывает, есть ли что двигать под мышью.
    // Хит-тест дёшево, но состояние трогаем только при смене фигуры.
    if (spacePressed || isDrawTool(activeTool)) return

    const nextHoverId = move.hitTest(screenPointOf(event), viewport)
    if (nextHoverId === hoverIdRef.current) return

    hoverIdRef.current = nextHoverId
    setHoveredId(nextHoverId)
  }

  function onPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    const gesture = gestureRef.current
    if (gesture.mode === 'none' || gesture.pointerId !== event.pointerId) return

    gestureRef.current = { mode: 'none' }
    setCaptured(event.pointerId, false)

    if (gesture.mode === 'draw') {
      // Click придёт после pointerup — гасим его, чтобы не снять выделение
      // у только что созданной фигуры.
      skipNextClickRef.current = true
      draw.commit()
    } else if (gesture.mode === 'move') {
      // Так же гасим click: он придёт на поверхность (указатель был захвачен
      // ею) и снял бы выделение у только что передвинутой фигуры.
      skipNextClickRef.current = true
      move.commit()
    } else {
      endPan()
    }
  }

  /**
   * Фон — значит пусто: снимаем выделение. Попадание по фигуре сюда не доходит:
   * pointerdown на фигуре не начинает жест, и клик гасится флагом выше.
   */
  function onBackgroundClick() {
    if (skipNextClickRef.current) {
      skipNextClickRef.current = false
      return
    }
    if (spacePressed) return
    clearSelection()
  }

  /** Кнопки зума тянут к центру холста, а не к левому верхнему углу. */
  function zoomFromCenter(multiplier: number) {
    const size = canvasSize()
    zoomBy(multiplier, { x: size.width / 2, y: size.height / 2 })
  }

  const gridStyle = useMemo<CSSProperties>(() => {
    const minor = GRID_SIZE * viewport.zoom
    const major = minor * GRID_MAJOR_EVERY
    const minorColor = minor < MINOR_GRID_MIN_PX ? 'transparent' : MINOR_LINE
    const axis = (color: string) =>
      `linear-gradient(to right, ${color} 1px, transparent 1px), linear-gradient(to bottom, ${color} 1px, transparent 1px)`

    const { panX, panY } = viewport

    return {
      backgroundImage: `${axis(MAJOR_LINE)}, ${axis(minorColor)}`,
      backgroundSize: `${major}px ${major}px, ${major}px ${major}px, ${minor}px ${minor}px, ${minor}px ${minor}px`,
      backgroundPosition: `${panX}px ${panY}px, ${panX}px ${panY}px, ${panX}px ${panY}px, ${panX}px ${panY}px`,
    }
  }, [viewport])

  const cursor =
    isPanning || move.draggingId
      ? 'grabbing'
      : spacePressed
        ? 'grab'
        : isDrawTool(activeTool)
          ? 'crosshair'
          : hoveredId
            ? 'move'
            : 'default'
  const canZoomIn = viewport.zoom < MAX_ZOOM
  const canZoomOut = viewport.zoom > MIN_ZOOM

  // Черновик рисуется обычной ShapeView — та же отрисовка, что у настоящей
  // фигуры, поэтому предпросмотр не может «разойтись» с результатом.
  const draftShape: Shape | null =
    draw.kind && draw.bounds
      ? {
          id: '__draft__',
          kind: draw.kind,
          name: '',
          bounds: draw.bounds,
          fill: DEFAULT_FILL,
          stroke: DEFAULT_STROKE,
          strokeWidth: DEFAULT_STROKE_WIDTH,
          visible: true,
          locked: false,
        }
      : null

  return (
    <div className="relative min-w-0 flex-1 overflow-hidden bg-slate-950 select-none">
      {/* Сетка: едет вместе с камерой, размер ячейки зависит от зума. */}
      <div className="absolute inset-0" style={gridStyle} />

      {/* Мир фигур. Один transform на весь слой — координаты фигур остаются
          «как в файле», а экранные пиксели появляются только в CSS.
          Поэтому фигуры масштабируются вместе с холстом сами по себе:
          ни Shape, ни useShapes о зуме не знают.
          Слой не перехватывает мышь: весь ввод принадлежит surface ниже. */}
      <div
        className="pointer-events-none absolute top-0 left-0 origin-top-left"
        style={{ transform: `translate3d(${viewport.panX}px, ${viewport.panY}px, 0) scale(${viewport.zoom})` }}
      >
        {shapes.map((shape) => (
          // Зум нужен фигуре только ради размера рамки выделения: маркеры
          // не должны расти вместе с масштабом холста.
          <ShapeView
            key={shape.id}
            shape={shape}
            isSelected={isSelected(shape.id)}
            zoom={viewport.zoom}
          />
        ))}

        {/* Незавершённая протяжка. Полупрозрачная — это ещё не фигура. */}
        {draftShape && (
          <div style={{ opacity: 0.6 }}>
            <ShapeView shape={draftShape} />
          </div>
        )}
      </div>

      {/* Поверх всего — единственная поверхность ввода: панорамирование,
          рисование протяжкой, выделение и перетаскивание. Фигуры её не
          перехватывают: попадание под курсором считает хит-тест в useShapes,
          поэтому слой фигур остаётся pointer-events-none. */}
      <div
        ref={attachSurface}
        className="absolute inset-0"
        style={{ cursor }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClick={onBackgroundClick}
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      />

      {/* Подсказка при переносе файла: холст — цель, но вставку выполняет
          обработчик drop выше, поэтому рамка ничего не перехватывает. */}
      {isFileDragOver && (
        <div
          className="pointer-events-none absolute inset-3 flex items-center justify-center rounded-xl border-2 border-dashed border-sky-400/70 bg-sky-500/10"
          aria-hidden="true"
        >
          <span className="rounded-md bg-slate-900/90 px-3 py-1.5 text-xs text-sky-200 ring-1 ring-sky-500/40">
            Отпустите, чтобы вставить картинку
          </span>
        </div>
      )}

      {/* Служебная панель: зум и подсказки по управлению. */}
      <div className="pointer-events-none absolute bottom-3 left-3 flex items-center gap-2 text-[11px] text-slate-400">
        <span className="rounded-md bg-slate-900/80 px-2 py-1 ring-1 ring-slate-700/70">
          Пробел + мышь — панорама · колесо — зум
        </span>
        <span className="rounded-md bg-slate-900/80 px-2 py-1 ring-1 ring-slate-700/70">
          {UNDO_HINT} — отменить · {REDO_HINT} — вернуть
        </span>
        <span className="rounded-md bg-slate-900/80 px-2 py-1 ring-1 ring-slate-700/70">
          {INSERT_IMAGE_HINT}
        </span>
        {isDrawTool(activeTool) && (
          <span className="rounded-md bg-sky-500/15 px-2 py-1 text-sky-300 ring-1 ring-sky-500/40">
            Тяните мышью, чтобы нарисовать фигуру
          </span>
        )}
      </div>

      <div className="absolute right-3 bottom-3 flex items-center gap-1 rounded-lg bg-slate-900/90 p-1 text-xs text-slate-300 ring-1 ring-slate-700">
        <button
          type="button"
          onClick={() => zoomFromCenter(1 / ZOOM_STEP)}
          disabled={!canZoomOut}
          className="h-6 w-6 rounded-md text-slate-200 transition hover:bg-slate-700/70 disabled:cursor-not-allowed disabled:opacity-40"
          title="Отдалить"
        >
          −
        </button>
        <button
          type="button"
          onClick={() => zoomFromCenter(ZOOM_STEP)}
          disabled={!canZoomIn}
          className="h-6 w-14 rounded-md transition hover:bg-slate-700/70 disabled:cursor-not-allowed disabled:opacity-40"
          title="Приблизить"
        >
          {zoomPercent}%
        </button>
        <button
          type="button"
          onClick={() => centerView(canvasSize())}
          className="h-6 rounded-md px-2 text-slate-200 transition hover:bg-slate-700/70"
          title="Сбросить вид"
        >
          1:1
        </button>
      </div>
    </div>
  )
}
