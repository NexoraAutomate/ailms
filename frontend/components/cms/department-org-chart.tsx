'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Background,
  Controls,
  Handle,
  MiniMap,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  MarkerType,
  addEdge,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
  type OnNodeDrag,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Link2, Pencil, Plus, Trash2, X } from 'lucide-react'
import { useAppData } from '@/components/app-provider'
import { Badge, Card, PageTitle } from '@/components/cms/ui'
import { Button } from '@/components/ui/button'
import { IconActionButton } from '@/components/ui/icon-action-button'
import type { Department, DepartmentInput } from '@/services/management'
import { updateDepartment } from '@/services/management'

type DeptNodeData = {
  department: Department
  onEdit: (department: Department) => void
  onDelete: (department: Department) => void
}

type DeptNode = Node<DeptNodeData, 'department'>

function DepartmentNode({ data, selected }: NodeProps<DeptNode>) {
  const { department, onEdit, onDelete } = data
  const inactive = department.status !== 'Active'
  return (
    <div
      className={`min-w-[200px] rounded-lg border bg-white px-3 py-2.5 shadow-sm transition ${
        selected ? 'border-[#1769aa] ring-2 ring-[#1769aa]/20' : 'border-slate-200'
      } ${inactive ? 'opacity-60' : ''}`}
    >
      <Handle type="target" position={Position.Top} className="!h-2.5 !w-2.5 !border-2 !border-white !bg-[#0d3763]" />
      <div className="mb-1 flex items-start justify-between gap-2">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{department.code}</p>
          <p className="text-sm font-bold text-[#102a43]">{department.name}</p>
        </div>
        <Badge tone={inactive ? 'slate' : 'green'}>{department.status}</Badge>
      </div>
      <p className="text-[11px] text-slate-500">{department.head || 'No head assigned'}</p>
      <div className="mt-2 flex items-center justify-between gap-2 border-t border-slate-100 pt-2 text-[10px] text-slate-400">
        <span>{department.users} users · {department.pending} pending</span>
        <div className="flex gap-0.5">
          <IconActionButton
            label="Edit"
            icon={Pencil}
            onClick={(e) => {
              e.stopPropagation()
              onEdit(department)
            }}
          />
          <IconActionButton
            label="Delete"
            icon={Trash2}
            tone="danger"
            onClick={(e) => {
              e.stopPropagation()
              onDelete(department)
            }}
          />
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} className="!h-2.5 !w-2.5 !border-2 !border-white !bg-[#1769aa]" />
      <Handle type="source" id="side" position={Position.Right} className="!h-2.5 !w-2.5 !border-2 !border-white !bg-emerald-600" />
      <Handle type="target" id="side" position={Position.Left} className="!h-2.5 !w-2.5 !border-2 !border-white !bg-emerald-600" />
    </div>
  )
}

const nodeTypes = { department: DepartmentNode }

type FormState = {
  code: string
  name: string
  head: string
  status: string
  parentId: string
}

const emptyForm: FormState = { code: '', name: '', head: '', status: 'Active', parentId: '' }

function DepartmentDialog({
  title,
  departments,
  initial,
  excludeId,
  onClose,
  onSubmit,
  onDelete,
}: {
  title: string
  departments: Department[]
  initial?: Department | null
  excludeId?: number
  onClose: () => void
  onSubmit: (values: DepartmentInput) => Promise<void>
  onDelete?: () => Promise<void>
}) {
  const [values, setValues] = useState<FormState>(() =>
    initial
      ? {
          code: initial.code,
          name: initial.name,
          head: initial.head,
          status: initial.status,
          parentId: initial.parentId ? String(initial.parentId) : '',
        }
      : emptyForm,
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const parents = departments.filter((d) => d.id !== excludeId)

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-slate-900/30 p-4">
      <Card className="w-full max-w-lg p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-bold text-slate-700">{title}</h2>
          <button type="button" onClick={onClose}><X className="size-4 text-slate-400" /></button>
        </div>
        <div className="grid gap-3">
          {[
            { name: 'code', label: 'Code' },
            { name: 'name', label: 'Department name' },
            { name: 'head', label: 'Head / responsible officer' },
          ].map((field) => (
            <label key={field.name} className="flex flex-col gap-1">
              <span className="text-xs font-semibold text-slate-600">{field.label}</span>
              <input
                className="h-10 rounded-md border border-slate-200 px-3 text-xs"
                value={values[field.name as keyof FormState]}
                onChange={(e) => setValues((current) => ({ ...current, [field.name]: e.target.value }))}
              />
            </label>
          ))}
          <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-slate-600">Reports to (org hierarchy)</span>
            <select
              className="h-10 rounded-md border border-slate-200 bg-white px-3 text-xs"
              value={values.parentId}
              onChange={(e) => setValues((current) => ({ ...current, parentId: e.target.value }))}
            >
              <option value="">None (top-level)</option>
              {parents.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold text-slate-600">Status</span>
            <select
              className="h-10 rounded-md border border-slate-200 bg-white px-3 text-xs"
              value={values.status}
              onChange={(e) => setValues((current) => ({ ...current, status: e.target.value }))}
            >
              <option value="Active">Active</option>
              <option value="Inactive">Inactive</option>
            </select>
          </label>
        </div>
        {error && <p className="mt-3 text-xs text-red-600">{error}</p>}
        <div className="mt-4 flex items-center justify-between gap-2">
          {onDelete ? (
            <Button
              variant="destructive"
              disabled={busy}
              onClick={async () => {
                if (!confirm(`Delete department “${initial?.name}”?`)) return
                setBusy(true)
                setError('')
                try {
                  await onDelete()
                  onClose()
                } catch (err) {
                  setError(err instanceof Error ? err.message : 'Unable to delete')
                } finally {
                  setBusy(false)
                }
              }}
            >
              <Trash2 data-icon="inline-start" />Delete
            </Button>
          ) : <span />}
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button
              disabled={busy || !values.code.trim() || !values.name.trim()}
              onClick={async () => {
                setBusy(true)
                setError('')
                try {
                  await onSubmit({
                    code: values.code.trim(),
                    name: values.name.trim(),
                    head: values.head.trim(),
                    status: values.status,
                    parentId: values.parentId ? Number(values.parentId) : null,
                  })
                  onClose()
                } catch (err) {
                  setError(err instanceof Error ? err.message : 'Unable to save')
                } finally {
                  setBusy(false)
                }
              }}
            >
              Save
            </Button>
          </div>
        </div>
      </Card>
    </div>
  )
}

function OrgChartCanvas({ embedded = false }: { embedded?: boolean }) {
  const {
    departments,
    departmentLinks,
    addDepartment,
    editDepartment,
    removeDepartment,
    addDepartmentLink,
    removeDepartmentLink,
  } = useAppData()

  const [addOpen, setAddOpen] = useState(false)
  const [editing, setEditing] = useState<Department | null>(null)
  const [busyMsg, setBusyMsg] = useState('')

  const onEdit = useCallback((department: Department) => setEditing(department), [])
  const onDelete = useCallback(
    async (department: Department) => {
      if (!confirm(`Delete department “${department.name}”?`)) return
      try {
        setBusyMsg('')
        await removeDepartment(department.id)
      } catch (err) {
        setBusyMsg(err instanceof Error ? err.message : 'Unable to delete department')
      }
    },
    [removeDepartment],
  )

  const initialNodes = useMemo<DeptNode[]>(
    () =>
      departments.map((department, index) => ({
        id: String(department.id),
        type: 'department' as const,
        position: {
          x: department.posX ?? (index % 4) * 240,
          y: department.posY ?? Math.floor(index / 4) * 160,
        },
        data: { department, onEdit, onDelete },
      })),
    [departments, onDelete, onEdit],
  )

  const initialEdges = useMemo<Edge[]>(() => {
    const hierarchy: Edge[] = departments
      .filter((d) => d.parentId)
      .map((d) => ({
        id: `reports-${d.parentId}-${d.id}`,
        source: String(d.parentId),
        target: String(d.id),
        type: 'smoothstep',
        animated: false,
        style: { stroke: '#94a3b8', strokeDasharray: '6 4' },
        markerEnd: { type: MarkerType.ArrowClosed, color: '#94a3b8', width: 16, height: 16 },
        label: 'reports to',
        labelStyle: { fontSize: 9, fill: '#94a3b8' },
        selectable: false,
        focusable: false,
        deletable: false,
        data: { kind: 'reports' },
      }))

    const coordination: Edge[] = (departmentLinks ?? []).map((link) => ({
      id: `coord-${link.id}`,
      source: String(link.sourceId),
      target: String(link.targetId),
      sourceHandle: 'side',
      targetHandle: 'side',
      type: 'default',
      animated: true,
      style: { stroke: '#059669', strokeWidth: 1.5 },
      markerEnd: { type: MarkerType.ArrowClosed, color: '#059669', width: 16, height: 16 },
      label: 'coordinates',
      labelStyle: { fontSize: 9, fill: '#059669' },
      data: { kind: 'coordinates', linkId: link.id },
    }))

    return [...hierarchy, ...coordination]
  }, [departmentLinks, departments])

  const [nodes, setNodes, onNodesChange] = useNodesState<DeptNode>(initialNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(initialEdges)

  useEffect(() => {
    setNodes(initialNodes)
  }, [initialNodes, setNodes])

  useEffect(() => {
    setEdges(initialEdges)
  }, [initialEdges, setEdges])

  const onConnect = useCallback(
    async (connection: Connection) => {
      if (!connection.source || !connection.target) return
      const sourceId = Number(connection.source)
      const targetId = Number(connection.target)
      if (!sourceId || !targetId || sourceId === targetId) return
      setBusyMsg('')
      setEdges((eds) => addEdge({ ...connection, animated: true, style: { stroke: '#059669' } }, eds))
      try {
        await addDepartmentLink({ sourceId, targetId, kind: 'coordinates' })
      } catch (err) {
        setBusyMsg(err instanceof Error ? err.message : 'Unable to create coordination link')
      }
    },
    [addDepartmentLink, setEdges],
  )

  const onEdgesDelete = useCallback(
    async (deleted: Edge[]) => {
      for (const edge of deleted) {
        const linkId = edge.data?.linkId
        if (typeof linkId === 'number') {
          try {
            await removeDepartmentLink(linkId)
          } catch (err) {
            setBusyMsg(err instanceof Error ? err.message : 'Unable to remove link')
          }
        }
      }
    },
    [removeDepartmentLink],
  )

  const persistPosition: OnNodeDrag = useCallback((_event, node) => {
    const id = Number(node.id)
    if (!id) return
    void updateDepartment(id, { posX: node.position.x, posY: node.position.y }).catch(() => {
      setBusyMsg('Unable to save department position')
    })
  }, [])

  return (
    <>
      {!embedded ? (
        <PageTitle
          title="Departments"
          description="Define the organization structure and how departments coordinate for correspondence management."
          action={
            <Button onClick={() => setAddOpen(true)}>
              <Plus data-icon="inline-start" />Add department
            </Button>
          }
        />
      ) : (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-bold text-slate-700">Departments</h3>
            <p className="text-xs text-slate-500">Organization structure and correspondence coordination.</p>
          </div>
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus data-icon="inline-start" />Add department
          </Button>
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-4 text-[11px] text-slate-500">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-px w-6 border-t border-dashed border-slate-400" /> Reports to (hierarchy)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-px w-6 border-t-2 border-emerald-600" /> Coordinates (correspondence)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Link2 className="size-3.5" /> Drag between side handles to link departments · select a green edge and press Delete to remove
        </span>
      </div>

      {busyMsg && (
        <p className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">{busyMsg}</p>
      )}

      <Card className={`${embedded ? 'h-[min(55vh,560px)]' : 'h-[min(70vh,720px)]'} overflow-hidden`}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onEdgesDelete={onEdgesDelete}
          onNodeDragStop={persistPosition}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          deleteKeyCode={['Backspace', 'Delete']}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={18} size={1} color="#e2e8f0" />
          <Controls showInteractive={false} />
          <MiniMap
            nodeColor={() => '#0d3763'}
            maskColor="rgb(15 23 42 / 0.08)"
            className="!rounded-md !border !border-slate-200 !bg-white"
          />
          <Panel position="top-right" className="rounded-md border border-slate-200 bg-white/95 px-3 py-2 text-[11px] text-slate-500 shadow-sm">
            {departments.length} departments · {(departmentLinks ?? []).length} coordination links
          </Panel>
        </ReactFlow>
      </Card>

      {addOpen && (
        <DepartmentDialog
          title="Add department"
          departments={departments}
          onClose={() => setAddOpen(false)}
          onSubmit={async (values) => {
            const offset = departments.length
            await addDepartment({
              ...values,
              posX: 120 + (offset % 4) * 220,
              posY: 80 + Math.floor(offset / 4) * 180,
            })
          }}
        />
      )}

      {editing && (
        <DepartmentDialog
          title="Edit department"
          departments={departments}
          initial={editing}
          excludeId={editing.id}
          onClose={() => setEditing(null)}
          onSubmit={async (values) => {
            await editDepartment(editing.id, values)
          }}
          onDelete={async () => {
            await removeDepartment(editing.id)
          }}
        />
      )}
    </>
  )
}

export function DepartmentOrgChart({ embedded = false }: { embedded?: boolean }) {
  return (
    <ReactFlowProvider>
      <OrgChartCanvas embedded={embedded} />
    </ReactFlowProvider>
  )
}
