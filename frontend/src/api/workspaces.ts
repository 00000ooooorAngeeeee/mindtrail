import { del, get, post, put } from './client'
import type { Workspace } from './types'

export function fetchWorkspaces(): Promise<Workspace[]> {
  return get<Workspace[]>('/workspaces')
}

export function fetchWorkspace(id: number): Promise<Workspace> {
  return get<Workspace>(`/workspaces/${id}`)
}

export function createWorkspace(name: string): Promise<Workspace> {
  return post<Workspace>('/workspaces', { name })
}

export function updateWorkspace(id: number, patch: { name: string }): Promise<Workspace> {
  return put<Workspace>(`/workspaces/${id}`, patch)
}

export function deleteWorkspace(id: number): Promise<void> {
  return del<void>(`/workspaces/${id}`)
}
