import { deflateRaw } from 'pako'

const PLANTUML_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_'

function encode6Bit(value: number): string {
  return PLANTUML_ALPHABET[value & 0x3f]
}

function append3Bytes(byte1: number, byte2: number, byte3: number): string {
  const c1 = byte1 >> 2
  const c2 = ((byte1 & 0x3) << 4) | (byte2 >> 4)
  const c3 = ((byte2 & 0xf) << 2) | (byte3 >> 6)
  const c4 = byte3 & 0x3f
  return `${encode6Bit(c1)}${encode6Bit(c2)}${encode6Bit(c3)}${encode6Bit(c4)}`
}

export function encodePlantUml(source: string): string {
  const compressed = deflateRaw(source, { level: 9 })
  let encoded = ''

  for (let i = 0; i < compressed.length; i += 3) {
    if (i + 2 === compressed.length) {
      encoded += append3Bytes(compressed[i], compressed[i + 1], 0)
    } else if (i + 1 === compressed.length) {
      encoded += append3Bytes(compressed[i], 0, 0)
    } else {
      encoded += append3Bytes(compressed[i], compressed[i + 1], compressed[i + 2])
    }
  }

  return encoded
}

export function plantUmlSvgUrl(source: string, server: string): string {
  const normalizedServer = server.replace(/\/+$/, '')
  return `${normalizedServer}/svg/${encodePlantUml(source)}`
}

export function renderPlantUmlCode(html: string, server: string): string {
  const parser = new DOMParser()
  const doc = parser.parseFromString(html, 'text/html')
  const codeBlocks = doc.querySelectorAll('pre code.language-plantuml, pre code[class*="plantuml"]')

  for (const code of codeBlocks) {
    const pre = code.parentElement
    if (!pre) continue

    const source = code.textContent || ''
    const figure = doc.createElement('figure')
    figure.className = 'plantuml-diagram'

    const img = doc.createElement('img')
    img.alt = 'PlantUML diagram'
    img.loading = 'lazy'
    img.src = plantUmlSvgUrl(source, server)

    figure.appendChild(img)
    pre.replaceWith(figure)
  }

  return doc.body.innerHTML
}
