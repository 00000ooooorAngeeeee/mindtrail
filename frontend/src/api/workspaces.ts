import { get, post } from './client'
import type { Workspace } from './types'

export function fetchWorkspaces(): Promise<Workspace[]> {
  return get<Workspace[]>('/workspaces')
}

export function createWorkspace(name: string): Promise<Workspace> {
  return post<Workspace>('/workspaces', { name })
}
