import crypto from 'node:crypto'
import path from 'node:path'
import {DEFAULT_CATEGORIES, getConfig, sanitizeCategory, updateConfig, type Category} from './config.js'

/**
 * Categories: what kind of file a fetch is, by its address pattern or its
 * extension, and the folder it rests in when "a folder per category" is on.
 * Defaults: Compressed, Programs, Videos, Music, Pictures, Documents, Other.
 */

export type {Category}
export {DEFAULT_CATEGORIES}

export const getCategories = (): Category[] => getConfig().categories
export const OTHER = 'other'

/** '*' matches any run of characters, '?' one; case does not matter */
export function wildcard(pattern: string): RegExp {
  return new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`, 'i')
}

const extOf = (name: string) => /\.([a-z0-9]{1,12})$/i.exec(name.trim())?.[1]?.toLowerCase()

function nameFromUrl(url: string | undefined): string {
  if (!url) return ''
  try {
    return decodeURIComponent(new URL(url).pathname.split('/').pop() ?? '')
  } catch {
    return ''
  }
}

/** the category a file belongs to: an address pattern first, then its extension, else Other */
export function categoryFor(name: string | undefined, url?: string, list: Category[] = getCategories()): Category {
  if (url) for (const c of list) if (c.patterns.some(p => wildcard(p).test(url))) return c
  const ext = extOf(name || '') ?? extOf(nameFromUrl(url))
  if (ext) for (const c of list) if (c.exts.includes(ext)) return c
  return list.find(c => c.id === OTHER) ?? list.at(-1)!
}

/** the folder a category's files rest in, under `base` (Other rests in base itself unless it has a folder) */
export function folderFor(category: Category | undefined, base: string): string {
  if (!category) return base
  if (category.folder && path.isAbsolute(category.folder)) return category.folder
  if (category.id === OTHER) return base
  return path.join(base, category.name)
}

/** where a fetch should rest: the category folder when the setting is on, else the base */
export function restingFolder(base: string, category: Category | undefined): string {
  return getConfig().categoryFolders ? folderFor(category, base) : base
}

export function addCategory(input: Omit<Category, 'id'>): Category {
  const list = getCategories()
  const base = input.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 20) || 'category'
  const id = list.some(c => c.id === base) ? `${base}-${crypto.randomBytes(2).toString('hex')}` : base
  const category = sanitizeCategory({...input, id})
  if (!category) throw new Error('a category needs a name (up to 40 letters, none of < > : " / \\ | ? *)')
  updateConfig({categories: [...list.filter(c => c.id !== OTHER), category, ...list.filter(c => c.id === OTHER)]})
  return category
}

export function updateCategory(id: string, patch: Partial<Omit<Category, 'id'>>): Category {
  const list = getCategories()
  const current = list.find(c => c.id === id)
  if (!current) throw new Error('no such category')
  const next = sanitizeCategory({...current, ...patch, id})
  if (!next) throw new Error('a category needs a name (up to 40 letters, none of < > : " / \\ | ? *)')
  updateConfig({categories: list.map(c => (c.id === id ? next : c))})
  return next
}

/** remove a category (Other stays) */
export function removeCategory(id: string): void {
  if (id === OTHER) throw new Error('Other always stays')
  updateConfig({categories: getCategories().filter(c => c.id !== id)})
}

/** the six defaults and Other, as they came */
export function resetCategories(): Category[] {
  return updateConfig({categories: DEFAULT_CATEGORIES.map(c => ({...c, exts: [...c.exts], patterns: []}))}).categories
}
