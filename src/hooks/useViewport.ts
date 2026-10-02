/**
 * КАМЕРА. Логика без единого JSX-тега и без знания о фигурах.
 *
 * Отвечает ровно за три вещи: панорамирование, зум (10%–400%) и центрирование
 * при старте. Компонент Canvas только передаёт сюда события мыши.
 */

import { useCallback, useMemo, useState } from 'react'

import { INITIAL_ZOOM } from '../constants/viewport'
import type { Point, ScreenPoint, Size, Viewport } from '../types/shape'
import { zoomViewportAt } from '../utils/geometry'

export interface UseViewportResult {
  /** Текущее состояние камеры — источник истины для transform и сетки. */
  viewport: Viewport
  /** Зум в процентах для показа в интерфейсе: 1 → "100%". */
  zoomPercent: number
  /** Идёт ли сейчас протяжка холста (пробел + мышь). Меняет курсор. */
  isPanning: boolean
  /** Начать / закончить панорамирование — из Canvas. */
  startPan: () => void
  endPan: () => void
  /** Сдвинуть холст на дельту в экранных пикселях. */
  panBy: (delta: Point) => void
  /** Поставить конкретный зум, удерживая точку под курсором. */
  zoomAt: (anchor: ScreenPoint, nextZoom: number) => void
  /** Умножить зум на factor, удерживая точку под курсором. */
  zoomBy: (factor: number, anchor: ScreenPoint) => void
  /** Поставить начало координат в центр видимой области. */
  centerView: (size: Size) => void
  /** Сброс камеры: зум INITIAL_ZOOM и то же центрирование. */
  resetView: (size: Size) => void
}

export function useViewport(): UseViewportResult {
  const [viewport, setViewport] = useState<Viewport>({ zoom: INITIAL_ZOOM, panX: 0, panY: 0 })
  const [isPanning, setIsPanning] = useState(false)

  const panBy = useCallback((delta: Point) => {
    setViewport((prev) => ({
      ...prev,
      panX: prev.panX + delta.x,
      panY: prev.panY + delta.y,
    }))
  }, [])

  const zoomAt = useCallback((anchor: ScreenPoint, nextZoom: number) => {
    setViewport((prev) => zoomViewportAt(prev, anchor, nextZoom))
  }, [])

  const zoomBy = useCallback((factor: number, anchor: ScreenPoint) => {
    setViewport((prev) => zoomViewportAt(prev, anchor, prev.zoom * factor))
  }, [])

  const centerView = useCallback((size: Size) => {
    setViewport({ zoom: INITIAL_ZOOM, panX: size.width / 2, panY: size.height / 2 })
  }, [])

  const resetView = useCallback((size: Size) => {
    setViewport({ zoom: INITIAL_ZOOM, panX: size.width / 2, panY: size.height / 2 })
  }, [])

  const startPan = useCallback(() => setIsPanning(true), [])
  const endPan = useCallback(() => setIsPanning(false), [])

  const zoomPercent = useMemo(() => Math.round(viewport.zoom * 100), [viewport.zoom])

  return {
    viewport,
    zoomPercent,
    isPanning,
    startPan,
    endPan,
    panBy,
    zoomAt,
    zoomBy,
    centerView,
    resetView,
  }
}
