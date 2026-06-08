"use client";
import { useState, useRef } from "react";
import {
  Download,
  FileText,
  FileSpreadsheet,
  X,
  AlertCircle,
  CheckCircle,
  Printer,
  Clock,
  ShieldAlert,
  Loader2,
  AlertTriangle,
  FileWarning,
} from "lucide-react";
import { apiGet, getApiError } from "@/lib/api";
import { useToast } from "@/store/uiStore";
import { useAuthStore } from "@/store/authStore";

interface ImportResult {
  success: number;
  failed: number;
  errors: Array<{ row: number; error: string; data: any }>;
  stockRequests?: number;
  stockRequestsFailed?: number;
}

interface ImportProgress {
  stage: "reading" | "validating" | "uploading" | "processing" | "done" | "error";
  percent: number;
  message: string;
}

// ── Validate CSV client-side before uploading ────────────────────────────────
function validateCSV(content: string): { valid: boolean; errors: string[]; rowCount: number } {
  const lines = content.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) {
    return { valid: false, errors: ["CSV file is empty or has no data rows."], rowCount: 0 };
  }

  const headers = lines[0].split(",").map((h) => h.trim().replace(/^"|"$/g, ""));
  const errors: string[] = [];

  // Required headers
  const required = ["sku"];
  required.forEach((col) => {
    if (!headers.includes(col)) {
      errors.push(`Missing required column: "${col}". Make sure you're using the correct template.`);
    }
  });

  // Warn about known template columns missing (non-blocking)
  const expectedCols = ["name", "price", "stockQuantity", "categoryId"];
  const missing = expectedCols.filter((c) => !headers.includes(c));
  if (missing.length > 0 && errors.length === 0) {
    errors.push(`Warning: Some expected columns are missing (${missing.join(", ")}). Only present columns will be updated.`);
  }

  const rowCount = lines.length - 1;

  // Check a few rows for obviously bad data
  for (let i = 1; i <= Math.min(5, lines.length - 1); i++) {
    const cols = lines[i].split(",");
    if (cols.length < headers.length - 3) {
      errors.push(`Row ${i + 1}: Fewer columns than expected. Check for missing commas or malformed data.`);
    }
  }

  return { valid: errors.length === 0 || errors[0].startsWith("Warning"), errors, rowCount };
}

// ── Trigger file download from fetch response ────────────────────────────────
async function downloadBlob(url: string, filename: string, token: string) {
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) {
    const text = await response.text();
    let msg = `Export failed (${response.status})`;
    try { msg = JSON.parse(text).message || msg; } catch {}
    throw new Error(msg);
  }
  const blob = await response.blob();
  const objectUrl = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  window.URL.revokeObjectURL(objectUrl);
  document.body.removeChild(a);
}

// ── Progress bar ─────────────────────────────────────────────────────────────
function ProgressBar({ percent, label }: { percent: number; label: string }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs text-gray-600">
        <span className="flex items-center gap-1.5">
          <Loader2 className="w-3.5 h-3.5 animate-spin text-brand-600" />
          {label}
        </span>
        <span className="font-bold text-brand-700">{percent}%</span>
      </div>
      <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden">
        <div
          className="h-2 rounded-full bg-brand-600 transition-all duration-300 ease-out"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

export function ImportExportModal({
  isOpen,
  onClose,
  onSuccess,
}: {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [activeTab, setActiveTab] = useState<"export" | "import">("export");
  const [isExporting, setIsExporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [preValidation, setPreValidation] = useState<{ errors: string[]; rowCount: number } | null>(null);
  const [showAllErrors, setShowAllErrors] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const { user } = useAuthStore();
  const isAdmin = user?.role === "ADMIN";

  if (!isOpen) return null;

  const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000/api/v1";
  const token = typeof window !== "undefined" ? localStorage.getItem("accessToken") || "" : "";

  const isImporting = progress !== null && progress.stage !== "done" && progress.stage !== "error";

  // ── Exports ─────────────────────────────────────────────────────────────────
  const handleExportCSV = async () => {
    setIsExporting(true);
    try {
      await downloadBlob(`${API_URL}/export/products/csv`, `products-${Date.now()}.csv`, token);
      toast("Products exported as CSV", "success");
    } catch (error) {
      toast(getApiError(error), "error");
    } finally {
      setIsExporting(false);
    }
  };

  const handleExportPDF = async () => {
    setIsExporting(true);
    try {
      await downloadBlob(`${API_URL}/export/products/pdf`, `products-${Date.now()}.pdf`, token);
      toast("Products exported as PDF", "success");
    } catch (error: any) {
      const msg: string = error?.message || "";
      if (msg.includes("500") || msg.includes("failed")) {
        await handlePrintFallback();
      } else {
        toast(getApiError(error), "error");
      }
    } finally {
      setIsExporting(false);
    }
  };

  const handlePrintFallback = async () => {
    try {
      const res = await apiGet<any>("/products?limit=500");
      const products = res.data.products || [];
      const html = `<html><head><title>Product Report</title>
        <style>body{font-family:Arial,sans-serif;font-size:11px;margin:20px}h1{font-size:18px;margin-bottom:4px}table{width:100%;border-collapse:collapse}th{background:#f3f4f6;text-align:left;padding:6px 8px;font-size:10px;text-transform:uppercase}td{padding:5px 8px;border-bottom:1px solid #e5e7eb}@media print{body{margin:10px}}</style>
        </head><body>
        <h1>Product Inventory Report</h1>
        <p style="color:#666;font-size:10px">Generated: ${new Date().toLocaleString()} | Total: ${products.length}</p>
        <table><tr><th>Product</th><th>SKU</th><th>Barcode</th><th>Price</th><th>Stock</th><th>Status</th><th>Category</th></tr>
        ${products.map((p: any) => `<tr><td>${p.name.substring(0, 50)}</td><td style="font-family:monospace">${p.sku}</td><td style="font-family:monospace">${p.barcode || "—"}</td><td>₦${Number(p.price).toLocaleString()}</td><td>${p.stockQuantity}</td><td>${p.status}</td><td>${p.category?.name || "—"}</td></tr>`).join("")}
        </table><script>window.onload=()=>{window.print();setTimeout(()=>window.close(),500)}</script></body></html>`;
      const win = window.open("", "_blank", "width=900,height=700");
      if (win) { win.document.write(html); win.document.close(); }
      else toast("Allow popups to generate PDF", "error");
    } catch (err) {
      toast(getApiError(err), "error");
    }
  };

  const handleDownloadTemplate = () => {
    const a = document.createElement("a");
    a.href = "/product-import-template.csv";
    a.download = "product-import-template.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    toast("Template downloaded", "success");
  };

  // ── Import with progress ────────────────────────────────────────────────────
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Reset state
    setImportResult(null);
    setPreValidation(null);
    setShowAllErrors(false);

    // ── Stage 1: Read file ──────────────────────────────────────────────────
    setProgress({ stage: "reading", percent: 10, message: "Reading file…" });

    if (!file.name.endsWith(".csv")) {
      toast("Only .csv files are supported. Please use the template provided.", "error");
      setProgress({ stage: "error", percent: 0, message: "Invalid file type" });
      resetInput();
      return;
    }

    if (file.size > 20 * 1024 * 1024) {
      toast("File is too large. Maximum size is 20MB.", "error");
      setProgress({ stage: "error", percent: 0, message: "File too large" });
      resetInput();
      return;
    }

    let csvContent = "";
    try {
      csvContent = await file.text();
    } catch {
      toast("Could not read the file. Make sure it's a valid CSV.", "error");
      setProgress({ stage: "error", percent: 0, message: "File read failed" });
      resetInput();
      return;
    }

    // ── Stage 2: Validate client-side ──────────────────────────────────────
    setProgress({ stage: "validating", percent: 25, message: "Validating CSV structure…" });
    await new Promise((r) => setTimeout(r, 150)); // let UI update

    const validation = validateCSV(csvContent);
    setPreValidation({ errors: validation.errors, rowCount: validation.rowCount });

    if (!validation.valid) {
      toast(validation.errors[0], "error");
      setProgress({ stage: "error", percent: 0, message: "Validation failed" });
      resetInput();
      return;
    }

    if (validation.rowCount === 0) {
      toast("No data rows found in the CSV.", "error");
      setProgress({ stage: "error", percent: 0, message: "Empty file" });
      resetInput();
      return;
    }

    // ── Stage 3: Upload ─────────────────────────────────────────────────────
    setProgress({ stage: "uploading", percent: 40, message: `Uploading ${validation.rowCount} rows…` });
    await new Promise((r) => setTimeout(r, 100));

    let response: Response;
    try {
      const formData = new FormData();
      formData.append("file", file);

      // Simulate progress during upload using XHR for real upload progress
      response = await new Promise<Response>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", `${API_URL}/export/products/import`);
        xhr.setRequestHeader("Authorization", `Bearer ${token}`);

        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) {
            const uploadPct = Math.round((event.loaded / event.total) * 25); // 40→65
            setProgress({
              stage: "uploading",
              percent: 40 + uploadPct,
              message: `Uploading… ${Math.round((event.loaded / event.total) * 100)}%`,
            });
          }
        };

        xhr.onload = () => {
          const res = new Response(xhr.responseText, {
            status: xhr.status,
            headers: { "Content-Type": "application/json" },
          });
          resolve(res);
        };
        xhr.onerror = () => reject(new Error("Network error — the server may be unreachable. Check that your backend is running."));
        xhr.ontimeout = () => reject(new Error("Request timed out. Large files may take a few minutes — try again."));
        xhr.timeout = 300_000; // 5 minutes for large catalogues
        xhr.send(formData);
      });
    } catch (err: any) {
      toast(err.message || "Upload failed. Check your connection.", "error");
      setProgress({ stage: "error", percent: 0, message: "Upload failed" });
      resetInput();
      return;
    }

    // ── Stage 4: Process response ───────────────────────────────────────────
    setProgress({ stage: "processing", percent: 80, message: "Processing results…" });
    await new Promise((r) => setTimeout(r, 200));

    let data: any;
    try {
      data = await response.json();
    } catch {
      toast("Server returned an unexpected response. Please try again.", "error");
      setProgress({ stage: "error", percent: 0, message: "Invalid server response" });
      resetInput();
      return;
    }

    if (!response.ok) {
      const errMsg = data?.message || data?.error || `Server error (${response.status})`;
      toast(errMsg, "error");
      setProgress({ stage: "error", percent: 0, message: errMsg });
      resetInput();
      return;
    }

    // ── Stage 5: Done ───────────────────────────────────────────────────────
    setProgress({ stage: "done", percent: 100, message: "Import complete" });
    const result: ImportResult = data.data;
    setImportResult(result);

    const hasErrors = result.failed > 0 || (result.stockRequestsFailed ?? 0) > 0;

    if (!isAdmin && (result.stockRequests ?? 0) > 0) {
      toast(`${result.stockRequests} stock change(s) submitted for admin approval`, "success");
      if (result.success > 0) onSuccess();
    } else if (result.success > 0 && !hasErrors) {
      toast(`${result.success} product(s) imported successfully`, "success");
      onSuccess();
    } else if (result.success > 0 && hasErrors) {
      toast(`${result.success} imported, ${result.failed} failed — see details below`, "error");
      onSuccess();
    } else if (result.failed > 0 && result.success === 0) {
      toast(`Import failed: all ${result.failed} rows had errors — see details below`, "error");
    }

    resetInput();
  };

  const resetInput = () => {
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const resetImport = () => {
    setProgress(null);
    setImportResult(null);
    setPreValidation(null);
    setShowAllErrors(false);
    resetInput();
  };

  const totalErrors = (importResult?.failed ?? 0) + (importResult?.stockRequestsFailed ?? 0);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full overflow-hidden max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-gray-100 shrink-0">
          <h2 className="font-semibold text-gray-900">Import / Export Products</h2>
          <button onClick={onClose} disabled={isImporting}>
            <X className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-100 shrink-0">
          {(["export", "import"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => { setActiveTab(tab); resetImport(); }}
              disabled={isImporting}
              className={`flex-1 py-3 text-sm font-medium transition-colors capitalize ${activeTab === tab ? "border-b-2 border-brand-600 text-brand-700" : "text-gray-500 hover:text-gray-700"}`}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="p-5 space-y-4 overflow-y-auto flex-1">

          {/* ── EXPORT TAB ── */}
          {activeTab === "export" && (
            <>
              <p className="text-xs text-gray-500">
                Download your product catalogue in your preferred format. The CSV export uses the same columns as the import template and can be re-imported directly.
              </p>
              <div className="grid grid-cols-1 gap-3">
                <button
                  onClick={handleExportCSV}
                  disabled={isExporting}
                  className="flex items-center gap-3 p-4 border border-gray-200 rounded-xl hover:border-green-400 hover:bg-green-50 transition-all disabled:opacity-50 text-left"
                >
                  <FileSpreadsheet className="w-8 h-8 text-green-600 shrink-0" />
                  <div>
                    <p className="font-semibold text-sm text-gray-900">Export as CSV</p>
                    <p className="text-xs text-gray-500">Same columns as the import template — ready to re-import</p>
                  </div>
                  {isExporting ? <Loader2 className="w-4 h-4 text-gray-400 ml-auto animate-spin" /> : <Download className="w-4 h-4 text-gray-400 ml-auto" />}
                </button>
                <button
                  onClick={handleExportPDF}
                  disabled={isExporting}
                  className="flex items-center gap-3 p-4 border border-gray-200 rounded-xl hover:border-red-400 hover:bg-red-50 transition-all disabled:opacity-50 text-left"
                >
                  <FileText className="w-8 h-8 text-red-500 shrink-0" />
                  <div>
                    <p className="font-semibold text-sm text-gray-900">Export as PDF</p>
                    <p className="text-xs text-gray-500">Printable inventory report</p>
                  </div>
                  {isExporting ? <Loader2 className="w-4 h-4 text-gray-400 ml-auto animate-spin" /> : <Printer className="w-4 h-4 text-gray-400 ml-auto" />}
                </button>
              </div>
            </>
          )}

          {/* ── IMPORT TAB ── */}
          {activeTab === "import" && (
            <>
              {/* Role notice */}
              {!isAdmin ? (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex gap-2 text-xs text-amber-800">
                  <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5 text-amber-500" />
                  <div className="space-y-1">
                    <p className="font-semibold">Stock changes require admin approval</p>
                    <p>
                      <strong>stockQuantity</strong> values will be submitted as pending requests.
                      Other fields update immediately. You cannot create new products via CSV.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 flex gap-2 text-xs text-blue-700">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>Use the template to ensure correct column format. Products are matched and updated by SKU. New rows create new products.</span>
                </div>
              )}

              {/* Template download */}
              <button
                onClick={handleDownloadTemplate}
                disabled={isImporting}
                className="w-full flex items-center justify-center gap-2 py-2.5 border border-dashed border-gray-300 rounded-xl text-sm text-gray-600 hover:border-brand-400 hover:text-brand-700 disabled:opacity-50 transition-colors"
              >
                <Download className="w-4 h-4" /> Download CSV Template
              </button>

              {/* File input — hidden while importing */}
              {!isImporting && progress?.stage !== "done" && (
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-2">
                    Upload CSV File
                  </label>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv"
                    onChange={handleFileChange}
                    disabled={isImporting}
                    className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:bg-brand-50 file:text-brand-700 file:font-medium file:text-xs hover:file:bg-brand-100 disabled:opacity-50"
                  />
                  <p className="text-xs text-gray-400 mt-1">
                    Max 20MB · CSV format only · Columns must match the template
                  </p>
                </div>
              )}

              {/* Pre-validation warnings */}
              {preValidation && preValidation.errors.length > 0 && !isImporting && progress?.stage !== "error" && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex gap-2 text-xs text-amber-800">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-500" />
                  <div>
                    {preValidation.errors.map((e, i) => (
                      <p key={i}>{e}</p>
                    ))}
                  </div>
                </div>
              )}

              {/* Progress bar */}
              {progress && progress.stage !== "done" && progress.stage !== "error" && (
                <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
                  <ProgressBar percent={progress.percent} label={progress.message} />
                  {preValidation && (
                    <p className="text-xs text-gray-400 mt-2 text-center">
                      {preValidation.rowCount} row{preValidation.rowCount !== 1 ? "s" : ""} detected
                    </p>
                  )}
                </div>
              )}

              {/* Error stage */}
              {progress?.stage === "error" && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-3 flex items-start gap-2 text-sm text-red-700">
                  <FileWarning className="w-4 h-4 shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="font-semibold">Import could not proceed</p>
                    <p className="text-xs mt-0.5 text-red-600">{progress.message}</p>
                  </div>
                  <button onClick={resetImport} className="text-xs text-red-500 hover:text-red-700 underline shrink-0">
                    Try again
                  </button>
                </div>
              )}

              {/* Results */}
              {importResult && progress?.stage === "done" && (
                <div className="space-y-2">
                  {/* Done header */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 text-xs text-gray-500">
                      <CheckCircle className="w-4 h-4 text-green-500" />
                      Import complete
                    </div>
                    <button onClick={resetImport} className="text-xs text-brand-600 hover:underline">
                      Import another file
                    </button>
                  </div>

                  {/* Completed progress bar at 100% */}
                  <div className="w-full bg-green-100 rounded-full h-2">
                    <div className="h-2 rounded-full bg-green-500 w-full" />
                  </div>

                  {/* Stock requests (non-admin) */}
                  {!isAdmin && (importResult.stockRequests ?? 0) > 0 && (
                    <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-50 border border-amber-200 text-sm text-amber-800">
                      <Clock className="w-4 h-4 shrink-0 mt-0.5 text-amber-500" />
                      <div>
                        <p className="font-semibold">
                          {importResult.stockRequests} stock change{importResult.stockRequests !== 1 ? "s" : ""} pending approval
                        </p>
                        <p className="text-xs mt-0.5 text-amber-600">
                          Admin will review in the Stock Approvals section.
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Success */}
                  {importResult.success > 0 && (
                    <div className="flex items-center gap-2 p-3 rounded-xl bg-green-50 border border-green-200 text-sm text-green-700">
                      <CheckCircle className="w-4 h-4 shrink-0" />
                      <span>
                        {isAdmin
                          ? `${importResult.success} product(s) imported / updated`
                          : `${importResult.success} product(s) updated (non-stock fields)`}
                      </span>
                    </div>
                  )}

                  {/* Summary counts */}
                  <div className="grid grid-cols-3 gap-2 text-center text-xs">
                    <div className="bg-gray-50 rounded-xl p-2">
                      <p className="font-bold text-lg text-gray-900">{importResult.success}</p>
                      <p className="text-gray-500">Updated</p>
                    </div>
                    {!isAdmin && (
                      <div className="bg-amber-50 rounded-xl p-2">
                        <p className="font-bold text-lg text-amber-700">{importResult.stockRequests ?? 0}</p>
                        <p className="text-amber-600">Pending approval</p>
                      </div>
                    )}
                    <div className={`rounded-xl p-2 ${totalErrors > 0 ? "bg-red-50" : "bg-gray-50"}`}>
                      <p className={`font-bold text-lg ${totalErrors > 0 ? "text-red-600" : "text-gray-400"}`}>{totalErrors}</p>
                      <p className={totalErrors > 0 ? "text-red-500" : "text-gray-400"}>Errors</p>
                    </div>
                  </div>

                  {/* Error detail list */}
                  {totalErrors > 0 && importResult.errors.length > 0 && (
                    <div className="bg-red-50 border border-red-200 rounded-xl p-3">
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-xs font-semibold text-red-700">
                          {totalErrors} row{totalErrors !== 1 ? "s" : ""} had errors:
                        </p>
                        {importResult.errors.length > 5 && (
                          <button
                            onClick={() => setShowAllErrors(!showAllErrors)}
                            className="text-xs text-red-500 hover:underline"
                          >
                            {showAllErrors ? "Show less" : `Show all ${importResult.errors.length}`}
                          </button>
                        )}
                      </div>
                      <div className="space-y-1 max-h-40 overflow-y-auto">
                        {(showAllErrors ? importResult.errors : importResult.errors.slice(0, 5)).map((e, i) => (
                          <div key={i} className="text-xs text-red-600 flex gap-1.5">
                            <span className="font-bold shrink-0">Row {e.row}:</span>
                            <span>{e.error}</span>
                          </div>
                        ))}
                        {!showAllErrors && importResult.errors.length > 5 && (
                          <p className="text-xs text-red-400 italic">
                            + {importResult.errors.length - 5} more errors…
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
