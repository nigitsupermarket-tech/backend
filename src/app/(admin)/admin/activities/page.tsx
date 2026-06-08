"use client";
// frontend/src/app/(admin)/admin/activities/page.tsx
// Admin-only: full activity log with filters, pagination, and detail modal

import { useState, useEffect, useCallback } from "react";
import { Search, X, Clock, User, Package, Tag, ShoppingCart, Settings, Shield, ChevronLeft, ChevronRight, ExternalLink } from "lucide-react";
import { apiGet, getApiError } from "@/lib/api";
import { useToast } from "@/store/uiStore";
import { formatDateTime } from "@/lib/utils";

interface ActivityLog {
  id: string;
  userId?: string;
  action: string;
  entity?: string;
  entityId?: string;
  ipAddress?: string;
  userAgent?: string;
  metadata?: Record<string, any>;
  createdAt: string;
  user?: { id: string; name: string; email: string; role: string };
}

const ENTITY_ICONS: Record<string, React.ElementType> = {
  product: Package, category: Tag, order: ShoppingCart, user: User,
  brand: Tag, settings: Settings, session: Clock, discount: Tag,
};

const ACTION_COLORS: Record<string, string> = {
  create: "bg-green-100 text-green-700",
  update: "bg-blue-100 text-blue-700",
  delete: "bg-red-100 text-red-700",
  login: "bg-purple-100 text-purple-700",
  logout: "bg-gray-100 text-gray-600",
  import: "bg-amber-100 text-amber-700",
  export: "bg-indigo-100 text-indigo-700",
};

function actionColor(action: string) {
  const key = Object.keys(ACTION_COLORS).find((k) => action.toLowerCase().includes(k));
  return key ? ACTION_COLORS[key] : "bg-gray-100 text-gray-600";
}

function EntityIcon({ entity }: { entity?: string }) {
  const Icon = ENTITY_ICONS[(entity || "").toLowerCase()] || Shield;
  return <Icon className="w-4 h-4" />;
}

function DetailModal({ log, onClose }: { log: ActivityLog; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-gray-100 rounded-xl">
              <EntityIcon entity={log.entity} />
            </div>
            <div>
              <p className="font-semibold text-gray-900 text-sm">{log.action}</p>
              {log.entity && <p className="text-xs text-gray-400 capitalize">{log.entity}</p>}
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-6 space-y-4 text-sm">
          {/* Who */}
          <div className="bg-gray-50 rounded-xl p-4 space-y-2">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Performed by</p>
            {log.user ? (
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-green-100 rounded-full flex items-center justify-center text-green-700 font-bold text-sm">
                  {log.user.name[0]}
                </div>
                <div>
                  <p className="font-medium text-gray-900">{log.user.name}</p>
                  <p className="text-xs text-gray-400">{log.user.email} · {log.user.role}</p>
                </div>
              </div>
            ) : (
              <p className="text-gray-400 text-xs">System / Unknown</p>
            )}
          </div>

          {/* When */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">When</p>
              <p className="text-gray-800">{formatDateTime(log.createdAt)}</p>
            </div>
            {log.entityId && (
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Entity ID</p>
                <p className="font-mono text-xs text-gray-600 break-all">{log.entityId}</p>
              </div>
            )}
          </div>

          {/* IP / UA */}
          {(log.ipAddress || log.userAgent) && (
            <div className="space-y-1">
              {log.ipAddress && (
                <div className="flex items-center gap-2 text-xs text-gray-500">
                  <Shield className="w-3.5 h-3.5" /> IP: {log.ipAddress}
                </div>
              )}
              {log.userAgent && (
                <p className="text-xs text-gray-400 truncate">{log.userAgent}</p>
              )}
            </div>
          )}

          {/* Metadata */}
          {log.metadata && Object.keys(log.metadata).length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Details</p>
              <pre className="bg-gray-900 text-green-400 rounded-xl p-4 text-xs overflow-auto max-h-48 font-mono leading-relaxed">
                {JSON.stringify(log.metadata, null, 2)}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ActivitiesPage() {
  const toast = useToast();
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [entityFilter, setEntityFilter] = useState("");
  const [selected, setSelected] = useState<ActivityLog | null>(null);

  const fetch = useCallback(async () => {
    setIsLoading(true);
    try {
      const params: Record<string, string> = { page: String(page), limit: "30" };
      if (search) params.search = search;
      if (entityFilter) params.entity = entityFilter;
      const qs = new URLSearchParams(params).toString();
      const res = await apiGet<any>(`/activities?${qs}`);
      setLogs(res.data.logs || []);
      setTotalPages(res.data.pagination?.totalPages || 1);
      setTotal(res.data.pagination?.total || 0);
    } catch (err) {
      toast(getApiError(err), "error");
    } finally {
      setIsLoading(false);
    }
  }, [page, search, entityFilter]);

  useEffect(() => { fetch(); }, [fetch]);

  // Debounce search
  useEffect(() => {
    setPage(1);
  }, [search, entityFilter]);

  const ENTITIES = ["product", "category", "brand", "order", "user", "settings", "session", "discount", "stock", "pos"];

  return (
    <div className="p-6 space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Activity Log</h1>
        <p className="text-sm text-gray-500 mt-1">{total.toLocaleString()} total actions recorded</p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search actions…"
            className="w-full pl-9 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:border-green-500 bg-white"
          />
        </div>
        <select
          value={entityFilter}
          onChange={(e) => setEntityFilter(e.target.value)}
          className="px-3 py-2.5 border border-gray-200 rounded-xl text-sm bg-white focus:outline-none focus:border-green-500"
        >
          <option value="">All entities</option>
          {ENTITIES.map((e) => <option key={e} value={e} className="capitalize">{e}</option>)}
        </select>
        {(search || entityFilter) && (
          <button
            onClick={() => { setSearch(""); setEntityFilter(""); setPage(1); }}
            className="flex items-center gap-1.5 px-3 py-2.5 text-sm text-gray-500 border border-gray-200 rounded-xl hover:bg-gray-50"
          >
            <X className="w-3.5 h-3.5" /> Clear
          </button>
        )}
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        {isLoading ? (
          <div className="space-y-px">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-14 bg-gray-50 animate-pulse border-b border-gray-100" />
            ))}
          </div>
        ) : logs.length === 0 ? (
          <div className="py-16 text-center text-gray-400">
            <Clock className="w-10 h-10 mx-auto mb-3 text-gray-200" />
            {search || entityFilter ? (
              <p>No activity matches your filters</p>
            ) : (
              <>
                <p className="font-medium">No activity recorded yet</p>
                <p className="text-xs mt-1 text-gray-300">Actions like login, product edits, orders and POS sales will appear here automatically</p>
              </>
            )}
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {logs.map((log) => (
              <button
                key={log.id}
                onClick={() => setSelected(log)}
                className="w-full flex items-center gap-4 px-5 py-3.5 hover:bg-gray-50 text-left transition-colors group"
              >
                {/* Entity icon */}
                <div className="p-2 bg-gray-100 rounded-lg shrink-0 group-hover:bg-gray-200 transition-colors">
                  <EntityIcon entity={log.entity} />
                </div>

                {/* Action + entity */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${actionColor(log.action)}`}>
                      {log.action}
                    </span>
                    {log.entity && (
                      <span className="text-xs text-gray-500 capitalize">{log.entity}</span>
                    )}
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5 truncate">
                    {log.user?.name || "System"} · {log.user?.email || ""}
                  </p>
                </div>

                {/* Role badge */}
                {log.user?.role && (
                  <span className="text-[10px] px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded shrink-0 hidden sm:block">
                    {log.user.role}
                  </span>
                )}

                {/* Time */}
                <div className="text-right shrink-0">
                  <p className="text-xs text-gray-500">{formatDateTime(log.createdAt)}</p>
                </div>

                <ExternalLink className="w-3.5 h-3.5 text-gray-300 group-hover:text-gray-500 shrink-0" />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-500">Page {page} of {totalPages}</p>
          <div className="flex gap-2">
            <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}
              className="p-2 border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-gray-50"
            ><ChevronLeft className="w-4 h-4" /></button>
            <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}
              className="p-2 border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-gray-50"
            ><ChevronRight className="w-4 h-4" /></button>
          </div>
        </div>
      )}

      {selected && <DetailModal log={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
