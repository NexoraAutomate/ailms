/** Marketing-only mock UI (demo showcase). Numbers are illustrative, not live API data. */
import type { ReactNode } from 'react'

function MockChrome({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-[#f5f8fb] text-left text-slate-900 shadow-lg">
      <div className="flex items-center gap-2 border-b border-slate-200 bg-white px-4 py-2.5">
        <div className="flex gap-1.5">
          <span className="size-2 rounded-full bg-red-400" />
          <span className="size-2 rounded-full bg-amber-400" />
          <span className="size-2 rounded-full bg-emerald-400" />
        </div>
        <span className="mx-auto text-[10px] font-medium text-slate-500">{title}</span>
      </div>
      <div className="p-4 sm:p-5">{children}</div>
    </div>
  )
}

function Kpi({ label, value, delta }: { label: string; value: string; delta?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-1 text-2xl font-bold text-[#102a43]">{value}</p>
      {delta && <p className="mt-1 text-[10px] font-semibold text-emerald-600">{delta}</p>}
    </div>
  )
}

export function MockExecutiveCommand() {
  return (
    <MockChrome title="ailms.app / executive-dashboard">
      <p className="text-xs text-slate-400">Workspace · Executive view</p>
      <h3 className="text-lg font-bold text-[#102a43]">National correspondence overview</h3>
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Kpi label="Total register" value="2,847" delta="+12.4% vs last quarter" />
        <Kpi label="SLA compliance" value="98.2%" delta="↑ 3.1 pts" />
        <Kpi label="Avg. response" value="1.8 days" delta="↓ 0.6 days" />
        <Kpi label="AI-assisted actions" value="416" delta="This month" />
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-slate-200 bg-white p-3">
          <p className="text-xs font-bold text-slate-600">Incoming vs outgoing (YTD)</p>
          <div className="mt-3 flex h-24 items-end gap-1">
            {[42, 58, 48, 72, 65, 88, 76, 92, 84, 96, 90, 102].map((h, i) => (
              <div key={i} className="flex flex-1 flex-col justify-end gap-0.5">
                <div className="w-full rounded-t bg-[#2d75b9]" style={{ height: `${h}%` }} />
                <div className="w-full rounded-t bg-[#8fb7d9]" style={{ height: `${Math.max(h - 18, 20)}%` }} />
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-3">
          <p className="text-xs font-bold text-slate-600">Risk signals (AI ranked)</p>
          <ul className="mt-2 space-y-2 text-[11px] text-slate-600">
            <li className="flex justify-between rounded bg-red-50 px-2 py-1.5"><span>Overdue — external orgs</span><b className="text-red-700">23</b></li>
            <li className="flex justify-between rounded bg-amber-50 px-2 py-1.5"><span>Approval pending &gt; 72h</span><b className="text-amber-800">11</b></li>
            <li className="flex justify-between rounded bg-emerald-50 px-2 py-1.5"><span>Closed on time</span><b className="text-emerald-800">94%</b></li>
          </ul>
        </div>
      </div>
    </MockChrome>
  )
}

export function MockAnalyticsStudio() {
  return (
    <MockChrome title="ailms.app / analytics">
      <h3 className="text-base font-bold text-[#102a43]">Analytics</h3>
      <p className="text-[11px] text-slate-400">Interactive management analytics · demo dataset</p>
      <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
        {[
          ['Closure rate', '94.6%'],
          ['Overdue', '23'],
          ['Pending', '187'],
          ['Avg response', '1.8d'],
        ].map(([l, v]) => (
          <Kpi key={l} label={l} value={v} />
        ))}
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <div className="rounded-lg border border-slate-200 bg-white p-3">
          <p className="text-xs font-bold text-slate-700">Correspondence trend</p>
          <div className="mt-2 flex h-28 items-end gap-2">
            {['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'].map((m, i) => (
              <div key={m} className="flex flex-1 flex-col items-center gap-1">
                <div className="flex h-20 w-full items-end justify-center gap-0.5">
                  <div className="w-2 rounded-t bg-[#2d75b9]" style={{ height: `${50 + i * 8}%` }} />
                  <div className="w-2 rounded-t bg-[#8fb7d9]" style={{ height: `${35 + i * 6}%` }} />
                </div>
                <span className="text-[9px] text-slate-400">{m}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-3">
          <p className="text-xs font-bold text-slate-700">Status distribution</p>
          <div className="mt-3 grid grid-cols-2 gap-2 text-[10px]">
            {[['Registered', '412'], ['In progress', '298'], ['Awaiting approval', '64'], ['Closed', '1,892']].map(([n, v]) => (
              <div key={n} className="flex justify-between rounded bg-slate-50 px-2 py-1.5">
                <span>{n}</span>
                <b>{v}</b>
              </div>
            ))}
          </div>
        </div>
      </div>
    </MockChrome>
  )
}

export function MockDepartmentHeatmap() {
  const rows = [
    { name: 'Coordination', pending: 42, completed: 318, overdue: 4 },
    { name: 'Technical', pending: 38, completed: 290, overdue: 7 },
    { name: 'Finance', pending: 21, completed: 205, overdue: 2 },
    { name: 'Legal', pending: 15, completed: 176, overdue: 1 },
    { name: 'External liaison', pending: 28, completed: 241, overdue: 5 },
  ]
  return (
    <MockChrome title="ailms.app / analytics · departments">
      <h3 className="text-base font-bold text-[#102a43]">Department workload</h3>
      <div className="mt-4 space-y-3">
        {rows.map((d) => (
          <div key={d.name}>
            <div className="mb-1 flex justify-between text-[11px]">
              <span className="font-semibold text-slate-700">{d.name}</span>
              <span className="text-slate-400">{d.pending} pending · {d.overdue} overdue</span>
            </div>
            <div className="flex h-2 overflow-hidden rounded-full bg-slate-100">
              <div className="bg-amber-400" style={{ width: `${d.pending / 5}%` }} />
              <div className="bg-[#2d75b9]" style={{ width: `${d.completed / 8}%` }} />
            </div>
          </div>
        ))}
      </div>
    </MockChrome>
  )
}

export function MockAiInsightsWall() {
  return (
    <MockChrome title="ailms.app / ai-insights">
      <h3 className="text-base font-bold text-[#102a43]">AI Management Insights</h3>
      <p className="text-[11px] text-slate-400">Advisory layer · illustrative analysis</p>
      <div className="mt-3 grid gap-2">
        {[
          { t: 'Attention required', b: '14 high-priority letters need DG-level review within 48 hours.', tone: 'border-red-200 bg-red-50' },
          { t: 'Throughput forecast', b: 'Projected 18% reduction in overdue items if current closure rate holds.', tone: 'border-emerald-200 bg-emerald-50' },
          { t: 'Organization cluster', b: 'SUPARCO & MOIT correspondence share 31% of pending external workload.', tone: 'border-blue-200 bg-blue-50' },
          { t: 'Recommendation', b: 'Prioritize procurement & technical files before routine circulars.', tone: 'border-violet-200 bg-violet-50' },
        ].map((c) => (
          <div key={c.t} className={`rounded-lg border p-3 ${c.tone}`}>
            <p className="text-xs font-bold text-slate-800">{c.t}</p>
            <p className="mt-1 text-[11px] leading-relaxed text-slate-600">{c.b}</p>
          </div>
        ))}
      </div>
    </MockChrome>
  )
}

export function MockReportsCenter() {
  return (
    <MockChrome title="ailms.app / reports">
      <h3 className="text-base font-bold text-[#102a43]">Reports & export center</h3>
      <div className="mt-3 flex flex-wrap gap-2">
        {['Incoming letters', 'Overdue register', 'SLA compliance', 'Audit pack'].map((r) => (
          <span key={r} className="rounded-full border border-slate-200 bg-white px-3 py-1 text-[10px] font-semibold text-slate-600">
            {r}
          </span>
        ))}
      </div>
      <table className="mt-4 w-full text-left text-[10px]">
        <thead className="text-slate-400">
          <tr>
            <th className="py-1">Letter</th>
            <th>Department</th>
            <th>Status</th>
            <th>Due</th>
          </tr>
        </thead>
        <tbody className="text-slate-700">
          {[
            ['IN/TECH/2026/884', 'Technical', 'Pending', 'Today'],
            ['OUT/ADM/2026/144', 'Coordination', 'Approved', '—'],
            ['IN/EXT/2026/502', 'External liaison', 'Overdue', '−3d'],
            ['IN/FIN/2026/331', 'Finance', 'In review', 'Fri'],
          ].map((row) => (
            <tr key={row[0]} className="border-t border-slate-100">
              {row.map((cell) => (
                <td key={cell} className="py-1.5 pr-2">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-3 text-[10px] font-semibold text-[#2d75b9]">Export PDF · CSV · Executive summary (demo)</p>
    </MockChrome>
  )
}

export function MockMontageStrip() {
  return (
    <div className="grid grid-cols-3 gap-2">
      <div className="rounded-lg bg-gradient-to-br from-[#0d3763] to-[#2d75b9] p-3 text-center text-white">
        <p className="text-2xl font-bold">2.8K+</p>
        <p className="text-[9px] uppercase tracking-wider opacity-80">Letters tracked</p>
      </div>
      <div className="rounded-lg bg-gradient-to-br from-indigo-900 to-blue-700 p-3 text-center text-white">
        <p className="text-2xl font-bold">98%</p>
        <p className="text-[9px] uppercase tracking-wider opacity-80">SLA target</p>
      </div>
      <div className="rounded-lg bg-gradient-to-br from-slate-800 to-slate-600 p-3 text-center text-white">
        <p className="text-2xl font-bold">24/7</p>
        <p className="text-[9px] uppercase tracking-wider opacity-80">Audit trail</p>
      </div>
    </div>
  )
}
