// 文件关联管理：设置页展示各扩展名关联状态，一键注册 / 设为默认。
// Windows：HKCU ProgID + OpenWithProgids（打开方式列表）；真正的默认项需在系统设置选择。
// macOS：LaunchServices 直接设 UTI 默认；Linux：xdg-mime 设 text/markdown 默认。

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

export interface AssocStatus {
  ext: string
  /** 本机"打开方式"列表里是否已注册 Ma读 */
  registered: boolean
  /** 是否已是系统默认打开方式 */
  isDefault: boolean
  /** 当前默认打开程序的可读标识 */
  currentHandler: string | null
}

export async function getAssociationStatus(): Promise<AssocStatus[]> {
  if (!isTauri) return []
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<AssocStatus[]>('association_status')
}

export async function setFileAssociation(ext: string): Promise<void> {
  if (!isTauri) throw new Error('仅在桌面应用内可用')
  const { invoke } = await import('@tauri-apps/api/core')
  await invoke('set_file_association', { ext })
}

export async function openDefaultAppsSettings(): Promise<void> {
  if (!isTauri) return
  const { invoke } = await import('@tauri-apps/api/core')
  await invoke('open_default_apps_settings')
}
