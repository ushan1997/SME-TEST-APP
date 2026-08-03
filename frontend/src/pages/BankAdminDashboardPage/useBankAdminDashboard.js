import { useCallback, useEffect, useMemo, useState } from "react";
import { API_BASE_URL } from "../../config/api";

export function useBankAdminDashboard(navigate) {
  const [dark, setDark] = useState(() => {
    const saved = localStorage.getItem("theme");
    return saved ? saved === "dark" : true;
  });
  const [activeTab, setActiveTab] = useState("approval");
  const [pending, setPending] = useState([]);
  const [summary, setSummary] = useState(null);
  const [industryData, setIndustryData] = useState([]);
  const [evaluatorData, setEvaluatorData] = useState(null);
  const [criterionData, setCriterionData] = useState([]);
  const [license, setLicense] = useState(null);
  const [auditLogs, setAuditLogs] = useState([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [smes, setSmes] = useState([]);
  const [selectedIds, setSelectedIds] = useState([]);
  const [comparisonData, setComparisonData] = useState([]);
  const [selectedEvaluatorId, setSelectedEvaluatorId] = useState("");
  const [selectedEvaluatorData, setSelectedEvaluatorData] = useState(null);
  const [selectedEvaluatorLoading, setSelectedEvaluatorLoading] = useState(false);
  const [selectedIndustry, setSelectedIndustry] = useState("");
  const [selectedCriterion] = useState("");
  const [loading, setLoading] = useState(true);
  const [analysisLoading, setAnalysisLoading] = useState(true);
  const [actionLoadingId, setActionLoadingId] = useState(null);
  const [error, setError] = useState("");
  const [successMsg, setSuccessMsg] = useState("");
  const [searchEvaluator, setSearchEvaluator] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [renewalNotice, setRenewalNotice] = useState("");
  const [passwordForm, setPasswordForm] = useState({ old_password: "", new_password: "", confirm_password: "" });
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordMsg, setPasswordMsg] = useState("");

  useEffect(() => {
    localStorage.setItem("theme", dark ? "dark" : "light");
  }, [dark]);

  const apiGet = useCallback(async (url) => {
    const token = localStorage.getItem("token");
    const res = await fetch(url, {
      headers: { "Content-Type": "application/json", Authorization: `Token ${token}` },
    });
    let data = null;
    let text = "";
    try { data = await res.json(); } catch { try { text = await res.text(); } catch { text = ""; } }
    if (!res.ok) throw new Error(data?.detail || data?.message || data?.error || text || `Request failed with status ${res.status}`);
    return data;
  }, []);

  const apiPost = useCallback(async (url, body = {}) => {
    const token = localStorage.getItem("token");
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Token ${token}` },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.detail || data?.message || data?.error || `Request failed with status ${res.status}`);
    return data;
  }, []);

  const fetchAuditLogs = useCallback(async () => {
    try {
      setAuditLoading(true);
      const data = await apiGet(`${API_BASE_URL}/api/audit-logs/?page_size=50`);
      setAuditLogs(Array.isArray(data?.results) ? data.results : []);
    } catch {
      setAuditLogs([]);
    } finally {
      setAuditLoading(false);
    }
  }, [apiGet]);

  const fetchPending = useCallback(async () => {
    try {
      setError("");
      setLoading(true);
      const data = await apiGet(`${API_BASE_URL}/api/bank-admin/pending-evaluators/`);
      setPending(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err.message || "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }, [apiGet]);

  const fetchAnalysisData = useCallback(async () => {
    try {
      setError("");
      setAnalysisLoading(true);
      const [summaryRes, industryRes, evaluatorRes, criterionRes, smeRes] = await Promise.all([
        apiGet(`${API_BASE_URL}/api/bank-admin/dashboard-summary/`),
        apiGet(`${API_BASE_URL}/api/bank-admin/industry-analysis/`),
        apiGet(`${API_BASE_URL}/api/bank-admin/evaluator-analysis/`),
        apiGet(`${API_BASE_URL}/api/bank-admin/criterion-analysis/`),
        apiGet(`${API_BASE_URL}/api/bank-admin/smes/`),
      ]);
      setSummary(summaryRes || null);
      setIndustryData(Array.isArray(industryRes) ? industryRes : []);
      setEvaluatorData(evaluatorRes || null);
      setCriterionData(Array.isArray(criterionRes) ? criterionRes : []);
      setSmes(Array.isArray(smeRes) ? smeRes : []);
      apiGet(`${API_BASE_URL}/api/license/current/`).then(setLicense).catch(() => setLicense(null));
      void fetchAuditLogs();
    } catch (err) {
      setError(err.message || "Failed to load analysis.");
    } finally {
      setAnalysisLoading(false);
    }
  }, [apiGet, fetchAuditLogs]);

  const fetchComparison = useCallback(async (ids) => {
    try {
      setError("");
      const data = await apiGet(`${API_BASE_URL}/api/bank-admin/sme-comparison/?ids=${ids.join(",")}`);
      setComparisonData(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err.message || "Failed to load comparison.");
    }
  }, [apiGet]);

  const fetchEvaluatorDistribution = useCallback(async (evaluatorId) => {
    try {
      setError("");
      setSelectedEvaluatorLoading(true);
      const data = await apiGet(`${API_BASE_URL}/api/bank-admin/evaluator-score-distribution/${evaluatorId}/`);
      setSelectedEvaluatorData(data || null);
    } catch (err) {
      setError(err.message || "Failed to load evaluator distribution.");
      setSelectedEvaluatorData(null);
    } finally {
      setSelectedEvaluatorLoading(false);
    }
  }, [apiGet]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void fetchPending();
      void fetchAnalysisData();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [fetchPending, fetchAnalysisData]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (selectedIds.length >= 2) void fetchComparison(selectedIds);
      else setComparisonData([]);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [selectedIds, fetchComparison]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (selectedEvaluatorId) void fetchEvaluatorDistribution(selectedEvaluatorId);
      else setSelectedEvaluatorData(null);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [selectedEvaluatorId, fetchEvaluatorDistribution]);

  async function runAction(profileId, actionPath, successText, refreshSearch = false) {
    try {
      setError("");
      setRenewalNotice("");
      setSuccessMsg("");
      setActionLoadingId(profileId);
      await apiPost(actionPath);
      setSuccessMsg(successText);
      await Promise.all([
        fetchPending(),
        fetchAnalysisData(),
        refreshSearch && searchEvaluator.trim() ? handleSearchEvaluator() : Promise.resolve(),
      ]);
    } catch (err) {
      const message = err.message || "Action failed.";
      if (message.toLowerCase().includes("renew your software")) {
        setRenewalNotice(message);
      }
      setError(message);
    } finally {
      setActionLoadingId(null);
    }
  }

  async function handleSearchEvaluator() {
    try {
      setError("");
      setSuccessMsg("");
      setSearchLoading(true);
      if (!searchEvaluator.trim()) {
        setSearchResults([]);
        return;
      }
      const data = await apiGet(`${API_BASE_URL}/api/bank-admin/search-evaluators/?q=${encodeURIComponent(searchEvaluator.trim())}`);
      setSearchResults(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err.message || "Search failed.");
      setSearchResults([]);
    } finally {
      setSearchLoading(false);
    }
  }

  function toggleSme(id) {
    setSelectedIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 3) return prev;
      return [...prev, id];
    });
  }

  function logout() {
    localStorage.clear();
    navigate("/");
  }

  function openPasswordModal() {
    setPasswordMsg("");
    setPasswordForm({ old_password: "", new_password: "", confirm_password: "" });
    setShowPasswordModal(true);
  }

  function handlePasswordInput(e) {
    const { name, value } = e.target;
    setPasswordForm((prev) => ({ ...prev, [name]: value }));
  }

  async function handleChangePassword(e) {
    e.preventDefault();
    setPasswordMsg("");
    if (!passwordForm.old_password || !passwordForm.new_password || !passwordForm.confirm_password) {
      setPasswordMsg("Please fill all password fields.");
      return;
    }
    if (passwordForm.new_password !== passwordForm.confirm_password) {
      setPasswordMsg("New password and confirm password do not match.");
      return;
    }
    setPasswordSaving(true);
    try {
      await apiPost(`${API_BASE_URL}/api/change-password/`, {
        old_password: passwordForm.old_password,
        new_password: passwordForm.new_password,
      });
      setPasswordMsg("Password changed successfully.");
      window.setTimeout(() => {
        localStorage.clear();
        navigate("/admin-login");
      }, 1200);
    } catch (err) {
      setPasswordMsg(err.message || "Failed to change password.");
    } finally {
      setPasswordSaving(false);
    }
  }

  async function handleExportSmes() {
    try {
      setError("");
      setExporting(true);
      const token = localStorage.getItem("token");
      const res = await fetch(`${API_BASE_URL}/api/bank-admin/smes/export/`, {
        headers: { Authorization: `Token ${token}` },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.detail || "Export failed.");
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "sme-portfolio-export.csv";
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      void fetchAuditLogs();
    } catch (err) {
      setError(err.message || "Export failed.");
    } finally {
      setExporting(false);
    }
  }

  function getBarHeight(value, max = 10) {
    const score = Number(value || 0);
    const top = Number(max || 10);
    if (top <= 0) return "6%";
    return `${Math.max((score / top) * 100, 6)}%`;
  }

  const selectedIndustryData = useMemo(
    () => industryData.find((item) => item.industry === selectedIndustry) || null,
    [industryData, selectedIndustry]
  );
  const selectedCriterionData = useMemo(
    () => criterionData.find((item) => item.criterion_code === selectedCriterion) || null,
    [criterionData, selectedCriterion]
  );
  const industryMaxScore = useMemo(() => {
    if (!selectedIndustryData?.smes?.length) return 10;
    return Math.max(...selectedIndustryData.smes.map((s) => Number(s.total_score || 0))) || 10;
  }, [selectedIndustryData]);
  const criterionMaxScore = useMemo(() => {
    if (!selectedCriterionData?.scores?.length) return 10;
    return Math.max(...selectedCriterionData.scores.map((s) => Number(s.score || 0))) || 10;
  }, [selectedCriterionData]);

  return {
    dark, setDark, activeTab, setActiveTab, pending, summary, industryData, evaluatorData, criterionData, license, smes,
    selectedIds, comparisonData, selectedEvaluatorId, setSelectedEvaluatorId, selectedEvaluatorData, selectedEvaluatorLoading,
    auditLogs, auditLoading, exporting,
    selectedIndustry, setSelectedIndustry, loading, analysisLoading, actionLoadingId, error, successMsg,
    searchEvaluator, setSearchEvaluator, searchResults, searchLoading, selectedIndustryData, industryMaxScore,
    criterionMaxScore, showPasswordModal, setShowPasswordModal, renewalNotice, setRenewalNotice, passwordForm, passwordSaving, passwordMsg,
    getBarHeight, toggleSme, logout, openPasswordModal, handlePasswordInput, handleChangePassword, handleSearchEvaluator, handleExportSmes,
    approve: (id) => runAction(id, `${API_BASE_URL}/api/bank-admin/approve-evaluator/${id}/`, "Evaluator approved successfully.", true),
    disapprove: (id) => runAction(id, `${API_BASE_URL}/api/bank-admin/disapprove-evaluator/${id}/`, "Evaluator disapproved and blocked successfully.", true),
    blockEvaluator: (id) => runAction(id, `${API_BASE_URL}/api/bank-admin/block-evaluator/${id}/`, "Evaluator blocked successfully.", true),
    unblockEvaluator: (id) => runAction(id, `${API_BASE_URL}/api/bank-admin/unblock-evaluator/${id}/`, "Evaluator unblocked successfully.", true),
  };
}
