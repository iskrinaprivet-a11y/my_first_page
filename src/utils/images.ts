/**
 * РАБОТА С ФАЙЛАМИ-КАРТИНКАМИ. Ни React, ни состояния — только браузерные API.
 *
 * Файл буфера обмена и файл, перетащенный из проводника, приходят одним и тем
 * же объектом File, а различаются только обёрткой события. Поэтому обе дороги
 * сводятся здесь к общему виду — списку файлов и, дальше, к размеру картинки.
 *
 * Файл правила проекта один: canvas = (screen - pan) / zoom. Здесь его не
 * нарушаем — ни одна функция не знает про камеру, координаты считает
 * вызывающий (useShapes).
 */

import { CLIPBOARD_FILE_KIND, IMAGE_MIME_PREFIX } from '../constants/images'

/**
 * Картинка, готовая к постановке на холст: адрес для <img> и её собственный
 * размер в пикселях.
 */
export interface LoadedImage {
  /** object URL, по которому браузер умеет показать картинку. */
  src: string
  /** Собственная ширина картинки (naturalWidth). */
  width: number
  /** Собственная высота картинки (naturalHeight). */
  height: number
}

/** Является ли файл картинкой. */
function isImageFile(file: File | null | undefined): file is File {
  return Boolean(file) && file?.type.startsWith(IMAGE_MIME_PREFIX) === true
}

/** Картинки из списка файлов — так отдают и буфер обмена, и проводник. */
function imageFilesFromList(files: readonly File[]): File[] {
  return files.filter(isImageFile)
}

/** Картинки из элементов буфера — запасной путь, когда список файлов пуст. */
function imageFilesFromItems(items: DataTransferItemList): File[] {
  const files: File[] = []

  for (const item of Array.from(items)) {
    if (item.kind !== CLIPBOARD_FILE_KIND) continue
    const file = item.getAsFile()
    if (isImageFile(file)) files.push(file)
  }

  return files
}

/**
 * Картинки из буфера обмена или из перетаскивания — ровно по одной на файл.
 *
 * Источник берётся ОДИН, и это не стилистика, а требование корректности:
 * списки `items` и `files` описывают одни и те же файлы, и настоящий буфер
 * отдаёт `items[0].getAsFile()` и `files[0]` РАЗНЫМИ экземплярами `File` с
 * одним и тем же содержимым. Сложить их вместе нельзя — сверка по ссылке такую
 * пару не поймает, и одна вставка даст две одинаковые фигуры.
 *
 * Основной источник — `files`: он заполнен и у буфера, и у переноса из
 * проводника. `items` используется только тогда, когда `files` пуст.
 *
 * Сверять файлы по содержимому (имени, размеру, дате) тоже нельзя: два
 * одинаковых файла, перетащенных за один раз, — это две фигуры, а не одна.
 *
 * Не-картинки молча отбрасываются: вставка текста из буфера должна работать
 * как обычно, поэтому вызывающий узнаёт о наличии картинок по длине списка.
 */
export function imageFilesFromDataTransfer(dataTransfer: DataTransfer | null): File[] {
  if (!dataTransfer) return []

  const fromFiles = imageFilesFromList(Array.from(dataTransfer.files))
  if (fromFiles.length > 0) return fromFiles

  return imageFilesFromItems(dataTransfer.items)
}

/**
 * Устраивает браузеру показать картинку и сообщает её собственный размер.
 *
 * Размер нужен затем, чтобы поставить картинку на холст в её настоящих
 * пропорциях: пока файл не декодирован, неизвестно даже, что он не пустой.
 * Пропорции берём здесь, а габариты на канвасе считает useShapes.
 *
 * Файл отдаётся через object URL, а не через FileReader с data: — без
 * четвертинки Base64 в памяти на каждое изображение.
 *
 * Отклоняется, если браузер не смог разобрать файл (битый PNG, «картинка» с
 * чужим расширением). Вызывающий пропустит такую картинку и продолжит.
 */
export function readImageFile(file: File): Promise<LoadedImage> {
  return new Promise<LoadedImage>((resolve, reject) => {
    const src = URL.createObjectURL(file)
    const probe = new Image()

    probe.onload = () => {
      // Не декодировалось — освобождаем URL, иначе он утечёт навсегда: картинки
      // с таким src у нас уже не будет.
      if (probe.naturalWidth <= 0 || probe.naturalHeight <= 0) {
        URL.revokeObjectURL(src)
        reject(new Error(`Файл «${file.name}» не похож на изображение`))
        return
      }

      resolve({ src, width: probe.naturalWidth, height: probe.naturalHeight })
    }

    probe.onerror = () => {
      URL.revokeObjectURL(src)
      reject(new Error(`Не удалось прочитать файл «${file.name}»`))
    }

    probe.src = src
  })
}