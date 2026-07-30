import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { createAppTheme } from "../styles/appTheme";
import { API_BASE_URL } from "../config/api";

export default function SuperAdmin() {
  const navigate = useNavigate();
  const [dark] = useState(() => localStorage.getItem("theme") === "dark");
  const theme = useMemo(() => createAppTheme(dark, dark ? darkTheme : lightTheme), [dark]);
  const [banks, setBanks] = useState([]);
  const [bankAdmins, setBankAdmins] = useState([]);
  const [licenseForms, setLicenseForms] = useState({});
  const [bankForm, setBankForm] = useState({ code: "", name: "" });
  const [adminForm, setAdminForm] = useState({
    username: "",
    password: "",
    first_name: "",
    last_name: "",
    email: "",
    bank_id: "",
  });
  const [passwordForms, setPasswordForms] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const token = localStorage.getItem("token");

  const api = useCallback(async (path, options = {}) => {
    const res = await fetch(`${path}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Token ${token}`,
        ...(options.headers || {}),
      },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const detail = typeof data === "object" ? Object.values(data).flat().join(" ") : "";
      throw new Error(data.detail || detail || `Request failed: ${res.status}`);
    }
    return data;
  }, [token]);

  const loadOverview = useCallback(async () => {
    try {
      setError("");
      setLoading(true);
      const data = await api(`${API_BASE_URL}/api/super-admin/overview/`);
      const nextBanks = Array.isArray(data.banks) ? data.banks : [];
      setBanks(nextBanks);
      setBankAdmins(Array.isArray(data.bank_admins) ? data.bank_admins : []);
      setLicenseForms((prev) => {
        const next = { ...prev };
        nextBanks.forEach((bank) => {
          if (!next[bank.id]) {
            next[bank.id] = {
              status: bank.license?.status || "TRIAL",
              seats: bank.license?.seats || 10,
              max_smes: bank.license?.max_smes || 100,
              max_evaluations: bank.license?.max_evaluations || 100,
              starts_on: bank.license?.starts_on || "",
              expires_on: bank.license?.expires_on || "",
            };
          }
        });
        return next;
      });
    } catch (err) {
      setError(err.message || "Failed to load super admin data.");
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadOverview();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadOverview]);

  function logout() {
    localStorage.clear();
    navigate("/");
  }

  async function createBank(event) {
    event.preventDefault();
    setSaving("bank");
    setError("");
    setMessage("");
    try {
      await api(`${API_BASE_URL}/api/super-admin/banks/`, {
        method: "POST",
        body: JSON.stringify({ ...bankForm, is_active: true }),
      });
      setBankForm({ code: "", name: "" });
      setMessage("Bank created successfully.");
      await loadOverview();
    } catch (err) {
      setError(err.message || "Failed to create bank.");
    } finally {
      setSaving("");
    }
  }

  async function createBankAdmin(event) {
    event.preventDefault();
    setSaving("admin");
    setError("");
    setMessage("");
    try {
      await api(`${API_BASE_URL}/api/super-admin/bank-admins/`, {
        method: "POST",
        body: JSON.stringify({ ...adminForm, bank_id: Number(adminForm.bank_id) }),
      });
      setAdminForm({ username: "", password: "", first_name: "", last_name: "", email: "", bank_id: "" });
      setMessage("Bank admin created successfully.");
      await loadOverview();
    } catch (err) {
      setError(err.message || "Failed to create bank admin.");
    } finally {
      setSaving("");
    }
  }

  async function resetBankAdminPassword(profileId) {
    const newPassword = passwordForms[profileId] || "";
    if (!newPassword.trim()) {
      setError("Enter a new password before saving.");
      setMessage("");
      return;
    }

    setSaving(`password-${profileId}`);
    setError("");
    setMessage("");
    try {
      const data = await api(`${API_BASE_URL}/api/super-admin/bank-admins/${profileId}/reset-password/`, {
        method: "POST",
        body: JSON.stringify({ new_password: newPassword }),
      });
      setPasswordForms((prev) => ({ ...prev, [profileId]: "" }));
      setMessage(data.detail || "Bank admin password updated successfully.");
    } catch (err) {
      setError(err.message || "Failed to update bank admin password.");
    } finally {
      setSaving("");
    }
  }

  function updateLicenseForm(bankId, field, value) {
    setLicenseForms((prev) => ({
      ...prev,
      [bankId]: {
        ...(prev[bankId] || {}),
        [field]: value,
      },
    }));
  }

  async function saveLicense(bankId) {
    const form = licenseForms[bankId] || {};
    const smeEvaluationLimit = Number(form.max_smes || 0);
    setSaving(`license-${bankId}`);
    setError("");
    setMessage("");
    try {
      await api(`${API_BASE_URL}/api/super-admin/banks/${bankId}/license/`, {
        method: "POST",
        body: JSON.stringify({
          status: form.status || "TRIAL",
          seats: Number(form.seats || 0),
          max_smes: smeEvaluationLimit,
          max_evaluations: smeEvaluationLimit,
          starts_on: form.starts_on || null,
          expires_on: form.expires_on || null,
          features: { audit_logs: true, csv_export: true, pdf_reports: true },
        }),
      });
      setMessage("Bank license updated successfully.");
      await loadOverview();
    } catch (err) {
      setError(err.message || "Failed to update license.");
    } finally {
      setSaving("");
    }
  }

  return (
    <div style={{ ...styles.page, background: theme.bg, color: theme.text }}>
      <h1 style={{ display: "none" }}>`dssds ${API_BASE_URL}`</h1>
      <header style={{ ...styles.header, borderBottom: `1px solid ${theme.border}`, background: theme.navBg }}>
        <div>
          <h1 style={styles.title}>Super Admin</h1>
          <p style={{ ...styles.subtitle, color: theme.muted }}>Create banks and bank admin accounts.</p>
        </div>
        <button onClick={logout} style={{ ...styles.secondaryBtn, borderColor: theme.border, color: theme.text, background: theme.card }}>
          Logout
        </button>
      </header>

      <main style={styles.main}>
        {(error || message) && (
          <div style={{ ...styles.notice, borderColor: error ? theme.errorBorder : theme.successBorder, background: error ? theme.errorBg : theme.successBg, color: error ? theme.errorText : theme.successText }}>
            {error || message}
          </div>
        )}

        <section style={styles.grid}>
          <form onSubmit={createBank} style={{ ...styles.panel, background: theme.card, borderColor: theme.border }}>
            <h2 style={styles.panelTitle}>Create Bank</h2>
            <input value={bankForm.code} onChange={(e) => setBankForm((p) => ({ ...p, code: e.target.value }))} placeholder="Bank code" required style={{ ...styles.input, background: theme.inputBg, borderColor: theme.border, color: theme.text }} />
            <input value={bankForm.name} onChange={(e) => setBankForm((p) => ({ ...p, name: e.target.value }))} placeholder="Bank name" required style={{ ...styles.input, background: theme.inputBg, borderColor: theme.border, color: theme.text }} />
            <button disabled={saving === "bank"} style={{ ...styles.primaryBtn, background: theme.primary }}>
              {saving === "bank" ? "Creating..." : "Create Bank"}
            </button>
          </form>

          <form onSubmit={createBankAdmin} style={{ ...styles.panel, background: theme.card, borderColor: theme.border }}>
              <h2 style={styles.panelTitle}> ${API_BASE_URL}/api/super-admin/bank-admins/ sdsd</h2>
               <h2 style={styles.panelTitle}>Create Bank Admin sdsd</h2>
            <h2 style={styles.panelTitle}>Create Bank Admin sdsd</h2>
           
            <select value={adminForm.bank_id} onChange={(e) => setAdminForm((p) => ({ ...p, bank_id: e.target.value }))} required style={{ ...styles.input, background: theme.inputBg, borderColor: theme.border, color: theme.text }}>
              <option value="">Select bank</option>
              {banks.map((bank) => <option key={bank.id} value={bank.id}>{bank.name} ({bank.code})</option>)}
            </select>
            <input value={adminForm.username} onChange={(e) => setAdminForm((p) => ({ ...p, username: e.target.value }))} placeholder="Username" required style={{ ...styles.input, background: theme.inputBg, borderColor: theme.border, color: theme.text }} />
            <input type="password" value={adminForm.password} onChange={(e) => setAdminForm((p) => ({ ...p, password: e.target.value }))} placeholder="Temporary password" required minLength={8} style={{ ...styles.input, background: theme.inputBg, borderColor: theme.border, color: theme.text }} />
            <div style={styles.twoCols}>
              <input value={adminForm.first_name} onChange={(e) => setAdminForm((p) => ({ ...p, first_name: e.target.value }))} placeholder="First name" style={{ ...styles.input, background: theme.inputBg, borderColor: theme.border, color: theme.text }} />
              <input value={adminForm.last_name} onChange={(e) => setAdminForm((p) => ({ ...p, last_name: e.target.value }))} placeholder="Last name" style={{ ...styles.input, background: theme.inputBg, borderColor: theme.border, color: theme.text }} />
            </div>
            <input type="email" value={adminForm.email} onChange={(e) => setAdminForm((p) => ({ ...p, email: e.target.value }))} placeholder="Email" style={{ ...styles.input, background: theme.inputBg, borderColor: theme.border, color: theme.text }} />
            <button disabled={saving === "admin"} style={{ ...styles.primaryBtn, background: theme.primary }}>
              {saving === "admin" ? "Creating..." : "Create Bank Admin"}
            </button>
          </form>
        </section>

        <section style={{ ...styles.panel, background: theme.card, borderColor: theme.border }}>
          <h2 style={styles.panelTitle}>Existing Bank Admins</h2>
          {loading ? <p style={{ color: theme.muted }}>Loading...</p> : (
            <div style={styles.tableWrap}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>Username</th>
                    <th style={styles.th}>Bank</th>
                    <th style={styles.th}>Email</th>
                    <th style={styles.th}>Status</th>
                    <th style={styles.th}>Password</th>
                  </tr>
                </thead>
                <tbody>
                  {bankAdmins.map((admin) => (
                    <tr key={admin.profile_id}>
                      <td style={styles.td}>{admin.username}</td>
                      <td style={styles.td}>{admin.bank_name} ({admin.bank_code})</td>
                      <td style={styles.td}>{admin.email || "-"}</td>
                      <td style={styles.td}>{admin.is_active ? "Active" : "Inactive"}</td>
                      <td style={styles.td}>
                        <div style={styles.passwordCell}>
                          <input
                            type="password"
                            value={passwordForms[admin.profile_id] || ""}
                            onChange={(e) =>
                              setPasswordForms((prev) => ({
                                ...prev,
                                [admin.profile_id]: e.target.value,
                              }))
                            }
                            placeholder="New password"
                            style={{
                              ...styles.inlineInput,
                              background: theme.inputBg,
                              borderColor: theme.border,
                              color: theme.text,
                            }}
                          />
                          <button
                            type="button"
                            disabled={saving === `password-${admin.profile_id}`}
                            onClick={() => resetBankAdminPassword(admin.profile_id)}
                            style={{ ...styles.inlineBtn, background: theme.primary }}
                          >
                            {saving === `password-${admin.profile_id}` ? "Saving..." : "Reset Password"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section style={{ ...styles.panel, background: theme.card, borderColor: theme.border }}>
          <h2 style={styles.panelTitle}>Bank Licensing Controls</h2>
          <div style={styles.licenseGrid}>
            {banks.map((bank) => {
              const form = licenseForms[bank.id] || {};
              const valid = bank.license?.is_valid;
              const daysRemaining = bank.license?.days_remaining;
              return (
                <div key={bank.id} style={{ ...styles.licenseCard, borderColor: theme.border, background: theme.inputBg }}>
                  <div style={styles.licenseTop}>
                    <div>
                      <strong>{bank.name}</strong>
                      <div style={{ color: theme.muted, fontSize: 13 }}>{bank.code}</div>
                      <div style={{ color: theme.muted, fontSize: 12, marginTop: 4 }}>
                        {daysRemaining == null ? "No expiry set" : daysRemaining < 0 ? "Expired" : `${daysRemaining} days remaining`}
                      </div>
                    </div>
                    <span style={{ ...styles.statusPill, background: valid ? "rgba(34,197,94,0.14)" : "rgba(239,68,68,0.14)", color: valid ? theme.successText : theme.errorText }}>
                      {bank.license?.status || "MISSING"}
                    </span>
                  </div>
                  <div style={styles.usageGrid}>
                    <div style={{ ...styles.usageBox, borderColor: theme.border, background: theme.card }}>
                      <span style={{ color: theme.muted }}>Evaluators</span>
                      <strong>{bank.license?.active_users ?? 0} / {form.seats || bank.license?.seats || 0}</strong>
                    </div>
                    <div style={{ ...styles.usageBox, borderColor: theme.border, background: theme.card }}>
                      <span style={{ color: theme.muted }}>SME / evaluations</span>
                      <strong>{bank.license?.smes_used ?? 0} / {form.max_smes || bank.license?.max_smes || 0}</strong>
                    </div>
                    <div style={{ ...styles.usageBox, borderColor: theme.border, background: theme.card }}>
                      <span style={{ color: theme.muted }}>Completed</span>
                      <strong>{bank.license?.evaluations_used ?? 0} / {form.max_smes || bank.license?.max_smes || 0}</strong>
                    </div>
                  </div>
                  <div style={styles.licenseFields}>
                    <select value={form.status || "TRIAL"} onChange={(e) => updateLicenseForm(bank.id, "status", e.target.value)} style={{ ...styles.input, background: theme.card, borderColor: theme.border, color: theme.text }}>
                      <option value="TRIAL">Trial</option>
                      <option value="ACTIVE">Active</option>
                      <option value="SUSPENDED">Suspended</option>
                      <option value="EXPIRED">Expired</option>
                    </select>
                    <input type="number" min="1" value={form.seats || ""} onChange={(e) => updateLicenseForm(bank.id, "seats", e.target.value)} placeholder="Seats" style={{ ...styles.input, background: theme.card, borderColor: theme.border, color: theme.text }} />
                    <input type="number" min="1" value={form.max_smes || ""} onChange={(e) => updateLicenseForm(bank.id, "max_smes", e.target.value)} placeholder="SME / evaluation limit" style={{ ...styles.input, background: theme.card, borderColor: theme.border, color: theme.text }} />
                    <label style={styles.dateField}>
                      <span style={{ color: theme.muted }}>Start date</span>
                      <input type="date" value={form.starts_on || ""} onChange={(e) => updateLicenseForm(bank.id, "starts_on", e.target.value)} style={{ ...styles.input, background: theme.card, borderColor: theme.border, color: theme.text }} />
                    </label>
                    <label style={styles.dateField}>
                      <span style={{ color: theme.muted }}>Expiry date</span>
                    <input type="date" value={form.expires_on || ""} onChange={(e) => updateLicenseForm(bank.id, "expires_on", e.target.value)} style={{ ...styles.input, background: theme.card, borderColor: theme.border, color: theme.text }} />
                    </label>
                  </div>
                  <button type="button" disabled={saving === `license-${bank.id}`} onClick={() => saveLicense(bank.id)} style={{ ...styles.primaryBtn, background: theme.primary }}>
                    {saving === `license-${bank.id}` ? "Saving..." : "Save License"}
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      </main>
    </div>
  );
}

const darkTheme = {
  bg: "#0B1220", navBg: "rgba(11,18,32,0.9)", text: "#FFFFFF", muted: "rgba(255,255,255,0.72)",
  card: "#111827", inputBg: "#0F172A", border: "rgba(255,255,255,0.12)", primary: "#2F96B4",
  errorBg: "rgba(239,68,68,0.10)", errorBorder: "rgba(239,68,68,0.24)", errorText: "#FCA5A5",
  successBg: "rgba(34,197,94,0.10)", successBorder: "rgba(34,197,94,0.24)", successText: "#86EFAC",
};

const lightTheme = {
  bg: "#F4F8FB", navBg: "rgba(255,255,255,0.9)", text: "#0F172A", muted: "#64748B",
  card: "#FFFFFF", inputBg: "#FFFFFF", border: "#E2E8F0", primary: "#2F96B4",
  errorBg: "rgba(239,68,68,0.08)", errorBorder: "rgba(239,68,68,0.20)", errorText: "#B91C1C",
  successBg: "rgba(34,197,94,0.08)", successBorder: "rgba(34,197,94,0.20)", successText: "#166534",
};

const styles = {
  page: { minHeight: "100vh", width: "100%", minWidth: 0, overflowX: "hidden", fontFamily: "Inter, system-ui, sans-serif" },
  header: { minHeight: 72, padding: "clamp(12px, 4vw, 16px) min(5vw, 48px)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" },
  title: { margin: 0, fontSize: "clamp(20px, 5vw, 24px)", fontWeight: 800 },
  subtitle: { margin: "4px 0 0", fontSize: 14 },
  main: { padding: "clamp(18px, 5vw, 24px) min(5vw, 48px) 48px", display: "grid", gap: 18 },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(280px, 100%), 1fr))", gap: 18 },
  panel: { border: "1px solid", borderRadius: 8, padding: "clamp(14px, 4vw, 18px)", display: "grid", gap: 12 },
  panelTitle: { margin: 0, fontSize: 18, fontWeight: 800 },
  input: { height: 42, border: "1px solid", borderRadius: 8, padding: "0 12px", fontSize: 14, boxSizing: "border-box", width: "100%" },
  twoCols: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10 },
  primaryBtn: { height: 42, border: 0, borderRadius: 8, color: "#fff", fontWeight: 800, cursor: "pointer" },
  secondaryBtn: { height: 38, border: "1px solid", borderRadius: 8, padding: "0 14px", fontWeight: 800, cursor: "pointer" },
  notice: { border: "1px solid", borderRadius: 8, padding: "10px 12px", fontSize: 14 },
  tableWrap: { overflowX: "auto" },
  table: { width: "100%", minWidth: 760, borderCollapse: "collapse", fontSize: 14 },
  th: { textAlign: "left", padding: "10px 8px", borderBottom: "1px solid rgba(148,163,184,0.3)" },
  td: { padding: "10px 8px", borderBottom: "1px solid rgba(148,163,184,0.18)" },
  passwordCell: { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" },
  inlineInput: { height: 38, minWidth: 0, flex: "1 1 180px", border: "1px solid", borderRadius: 8, padding: "0 12px", fontSize: 13, boxSizing: "border-box" },
  inlineBtn: { height: 38, border: 0, borderRadius: 8, color: "#fff", fontWeight: 700, cursor: "pointer", padding: "0 12px", whiteSpace: "nowrap" },
  licenseGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(320px, 100%), 1fr))", gap: 14 },
  licenseCard: { border: "1px solid", borderRadius: 8, padding: 14, display: "grid", gap: 12 },
  licenseTop: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 },
  statusPill: { borderRadius: 999, padding: "5px 10px", fontSize: 12, fontWeight: 800 },
  usageGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 8 },
  usageBox: { border: "1px solid", borderRadius: 8, padding: 10, display: "grid", gap: 4, fontSize: 12 },
  licenseFields: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 10 },
  dateField: { display: "grid", gap: 6, fontSize: 12, fontWeight: 700 },
};
