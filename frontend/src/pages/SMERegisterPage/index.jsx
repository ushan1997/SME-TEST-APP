import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import logo from "../../assets/logo.png";
import { createAppTheme } from "../../styles/appTheme";
import { industries } from "./constants";
import { styles } from "./styles";
import { darkTheme, lightTheme } from "./theme";
import { API_BASE_URL } from "../../config/api";

export default function SmeRegisterPage() {
  const navigate = useNavigate();
  const dropdownRef = useRef(null);
  const [themeMode] = useState(() => (localStorage.getItem("theme") === "light" ? "light" : "dark"));
  const theme = useMemo(() => createAppTheme(themeMode, themeMode === "dark" ? darkTheme : lightTheme), [themeMode]);
  const [form, setForm] = useState({ name: "", br_number: "", industry: "" });
  const [loading, setLoading] = useState(false);
  const [modal, setModal] = useState(null);
  const [industryOpen, setIndustryOpen] = useState(false);
  const [industrySearch, setIndustrySearch] = useState("");

  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) setIndustryOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const filteredIndustries = useMemo(() => {
    const q = industrySearch.trim().toLowerCase();
    return q ? industries.filter((item) => item.toLowerCase().includes(q)) : industries;
  }, [industrySearch]);

  function onChange(e) {
    setForm((f) => ({ ...f, [e.target.name]: e.target.value }));
  }

  async function onSubmit(e) {
    e.preventDefault();
    setLoading(true);
    try {
      const token = localStorage.getItem("token");
      if (!token) throw new Error("You are not logged in.");
      const res = await fetch(`${API_BASE_URL}/api/smes/`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Token ${token}` },
        body: JSON.stringify(form),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409) {
        setModal({ type: "error", message: data.detail });
        return;
      }
      if (!res.ok) throw new Error(data.detail || "Failed to register SME.");
      setModal({ type: "success", message: "SME registered successfully!" });
      setTimeout(() => navigate("/evaluator-home"), 1000);
    } catch (err) {
      setModal({ type: "error", message: err.message });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ ...styles.page, background: theme.bg, color: theme.text }}>
      <header style={{ ...styles.navbar, background: theme.navBg, borderBottom: `1px solid ${theme.border}` }}>
        <div style={styles.brand} onClick={() => navigate("/evaluator-home")}>
          <img src={logo} alt="logo" style={styles.logoImg} />
          <div>
            <div style={{ ...styles.brandTitle, color: theme.text }}>SME Scoring</div>
            <div style={{ ...styles.brandSub, color: theme.muted }}>Evaluator Workspace</div>
          </div>
        </div>
      </header>
      <main style={styles.main}>
        <div style={{ ...styles.card, background: theme.card, border: `1px solid ${theme.border}`, boxShadow: theme.shadow }}>
          <h2 style={{ ...styles.title, color: theme.text }}>Register New SME</h2>
          <p style={{ ...styles.subText, color: theme.muted }}>Add SME details before starting the evaluation process.</p>
          <form onSubmit={onSubmit} style={styles.form}>
            {["name", "br_number"].map((field) => (
              <input
                key={field}
                name={field}
                value={form[field]}
                onChange={onChange}
                required
                placeholder={field === "name" ? "SME Name" : "BR Number"}
                style={{ ...styles.input, background: theme.inputBg, color: theme.text, border: `1px solid ${theme.borderStrong}` }}
              />
            ))}
            <div style={{ position: "relative" }} ref={dropdownRef}>
              <div
                onClick={() => setIndustryOpen((s) => !s)}
                style={{ ...styles.input, display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer", minHeight: 48, background: theme.inputBg, color: theme.text, border: `1px solid ${theme.borderStrong}` }}
              >
                <span style={{ color: form.industry ? theme.text : theme.muted }}>{form.industry || "Select Industry"}</span>
                <span style={{ fontSize: 12, color: theme.muted }}>v</span>
              </div>
              {industryOpen && (
                <div style={{ ...styles.dropdownMenu, background: theme.dropdownBg, border: `1px solid ${theme.borderStrong}`, boxShadow: theme.shadow }}>
                  <input
                    type="text"
                    placeholder="Search industry..."
                    value={industrySearch}
                    onChange={(e) => setIndustrySearch(e.target.value)}
                    style={{ ...styles.input, marginBottom: 10, background: theme.inputBg, color: theme.text, border: `1px solid ${theme.borderStrong}` }}
                  />
                  <div style={styles.optionsList}>
                    {filteredIndustries.length > 0 ? filteredIndustries.map((item) => (
                      <div key={item} onClick={() => { setForm((f) => ({ ...f, industry: item })); setIndustrySearch(""); setIndustryOpen(false); }} style={{ ...styles.optionStyle, color: theme.text }}>{item}</div>
                    )) : <div style={{ padding: 10, color: theme.muted }}>No industry found</div>}
                  </div>
                </div>
              )}
            </div>
            <button type="submit" style={{ ...styles.btn, background: theme.button, color: theme.buttonText }} disabled={loading}>
              {loading ? "Saving..." : "Register SME"}
            </button>
          </form>
        </div>
      </main>
      {modal && (
        <div style={styles.modalOverlay}>
          <div style={{ ...styles.modalBox, background: theme.card, color: theme.text, border: `1px solid ${theme.borderStrong}` }}>
            <div style={{ fontWeight: 800, fontSize: 18 }}>
              {modal.message?.toLowerCase().includes("renew your software") ? "Renew Your Software" : modal.type === "error" ? "Registration Failed" : "Success"}
            </div>
            <div style={{ marginTop: 10, color: theme.muted }}>{modal.message}</div>
            <button style={{ ...styles.btn, marginTop: 16, background: theme.button, color: theme.buttonText }} onClick={() => setModal(null)}>OK</button>
          </div>
        </div>
      )}
    </div>
  );
}
