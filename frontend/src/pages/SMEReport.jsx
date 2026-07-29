import { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import logo from "../assets/logo.png";
import { appNavbarStyles, appShellStyles, createAppTheme } from "../styles/appTheme";
import { API_BASE_URL } from "../config/api";

// Fixed: corrected spelling of "Interest" and "advantage"
const CRITERIA_NAMES = [
  "Business opportunity gap",
  "Customer pains and gains",
  "Interest to take risk",
  "Stakeholder Engagement & Support",
  "Competitive Position",
  "Management & Workforce Capability",
  "Streams of Revenue",
  "Cost Control & Efficiency",
  "Taking advantage of state assistance",
  "Operational Readiness",
];

export default function SMEReport() {
  const { id } = useParams();
  const navigate = useNavigate();

  const token = localStorage.getItem("token") || "";
  const username = localStorage.getItem("username") || "";

  // Fixed: theme read inside useState so it doesn't freeze on mount
  const [dark] = useState(() => localStorage.getItem("theme") !== "light");
  const theme = useMemo(
    () => createAppTheme(dark, dark ? darkTheme : lightTheme),
    [dark]
  );

  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    if (!token) { navigate("/login", { replace: true }); return; }

    (async () => {
      setLoading(true);
      setErr("");
      try {
        const res = await fetch(`${API_BASE_URL}/api/smes/${id}/report/`, {
          headers: { Authorization: `Token ${token}` },
        });

        if (res.status === 401) {
          localStorage.removeItem("token");
          navigate("/login", { replace: true });
          return;
        }

        const text = await res.text();
        let j = {};
        try { j = text ? JSON.parse(text) : {}; } catch { j = {}; }

        if (!res.ok) throw new Error(j.detail || `Failed to load report. Status ${res.status}`);
        setData(j);
      } catch (e) {
        setErr(e.message || "Failed to load report.");
      } finally {
        setLoading(false);
      }
    })();
  }, [id, token, navigate]);

  function formatScoreDecimal(value) {
    if (value === null || value === undefined || value === "") return "—";
    const num = Number(value);
    return Number.isNaN(num) ? "—" : num.toFixed(2);
  }

  function formatScore(value) {
    if (value === null || value === undefined || value === "") return "—";
    const num = Number(value);
    return Number.isNaN(num) ? "—" : Math.round(num).toString();
  }

  function getCriterionCode(item, index) {
    return item.code || item.criterion_code || `C${index + 1}`;
  }

  function getCriterionOrder(item, index) {
    const code = getCriterionCode(item, index);
    const match = String(code).match(/\d+/);
    return match ? parseInt(match[0], 10) : 999;
  }

  function getCriterionTitle(item, index) {
    const order = getCriterionOrder(item, index);
    return (
      CRITERIA_NAMES[order - 1] ||
      item.label || item.name || item.title || item.criterion_name ||
      `Criterion ${order}`
    );
  }

  async function downloadPDF() {
    if (!token) { navigate("/login", { replace: true }); return; }

    try {
      setDownloading(true);
      const res = await fetch(`${API_BASE_URL}/api/smes/${id}/report/pdf/`, {
        headers: { Authorization: `Token ${token}` },
      });

      if (res.status === 401) {
        localStorage.removeItem("token");
        navigate("/login", { replace: true });
        return;
      }

      if (!res.ok) {
        const text = await res.text();
        let message = "Failed to download PDF.";
        try { const j = text ? JSON.parse(text) : {}; message = j.detail || message; } catch { if (text) message = text; }
        throw new Error(message);
      }

      const contentType = res.headers.get("content-type") || "";
      if (!contentType.toLowerCase().includes("pdf")) {
        const text = await res.text().catch(() => "");
        throw new Error(text || "Server did not return a PDF file.");
      }

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `SME_Report_${id}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (e) {
      alert(e.message || "Failed to download PDF.");
    } finally {
      setDownloading(false);
    }
  }

  if (loading) {
    return (
      <div style={{ ...styles.page, background: theme.bg, color: theme.text }}>
        <Navbar theme={theme} onLogoClick={() => navigate("/evaluator-home")} onDownloadPDF={downloadPDF} downloading={downloading} />
        <div style={styles.wrapper}><div style={styles.messageBox}>Loading report...</div></div>
      </div>
    );
  }

  if (err) {
    return (
      <div style={{ ...styles.page, background: theme.bg, color: theme.text }}>
        <Navbar theme={theme} onLogoClick={() => navigate("/evaluator-home")} onDownloadPDF={downloadPDF} downloading={downloading} />
        <div style={styles.wrapper}>
          <div style={{ ...styles.messageBox, background: theme.card, border: `1px solid ${theme.border}` }}>
            Error: {err}
          </div>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div style={{ ...styles.page, background: theme.bg, color: theme.text }}>
        <Navbar theme={theme} onLogoClick={() => navigate("/evaluator-home")} onDownloadPDF={downloadPDF} downloading={downloading} />
        <div style={styles.wrapper}>
          <div style={{ ...styles.messageBox, background: theme.card, border: `1px solid ${theme.border}` }}>
            No report data available.
          </div>
        </div>
      </div>
    );
  }

  const criteria = Array.isArray(data.criteria) ? [...data.criteria] : [];
  criteria.sort((a, b) => getCriterionOrder(a, 0) - getCriterionOrder(b, 0));

  const overallEvidence = data.additional_details || data.evidence || data.notes || data.overall_notes || "";

  return (
    <div style={{ ...styles.page, background: theme.bg, color: theme.text }}>
      <Navbar theme={theme} onLogoClick={() => navigate("/evaluator-home")} onDownloadPDF={downloadPDF} downloading={downloading} />

      <div style={styles.wrapper}>
        <div style={{ ...styles.reportSheet, background: theme.card, border: `1px solid ${theme.border}`, color: theme.text }}>
          <div style={styles.reportHeader}>
            <div>
              <div style={styles.reportTitle}>SME Evaluation Report</div>
              <div style={styles.reportSubtitle}>Decision Support Platform</div>
            </div>
            <div style={styles.scoreBox}>
              <div style={styles.scoreBoxLabel}>Total Score</div>
              <div style={styles.scoreBoxValue}>{formatScoreDecimal(data.capability_score)}</div>
            </div>
          </div>

          <section style={styles.section}>
            <h3 style={styles.sectionTitle}>SME Information</h3>
            <div style={styles.infoTable}>
              {[
                ["SME Name", data.name || "—"],
                ["BR Number", data.br_number || "—"],
                ["Industry", data.industry || "—"],
                ["Scored By", data.scored_by || username || "—"],
              ].map(([label, value]) => (
                <div key={label} style={styles.infoRow}>
                  <div style={styles.infoLabel}>{label}</div>
                  <div style={styles.infoValue}>{value}</div>
                </div>
              ))}
            </div>
          </section>

          <section style={styles.section}>
            <h3 style={styles.sectionTitle}>Criteria Scores</h3>
            <div style={styles.tableWrap}>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>Code</th>
                    <th style={styles.th}>Criterion</th>
                    <th style={styles.thRight}>Score</th>
                  </tr>
                </thead>
                <tbody>
                  {criteria.length === 0 ? (
                    <tr><td style={styles.td} colSpan={3}>No criteria scores available.</td></tr>
                  ) : (
                    criteria.map((item, index) => {
                      const code = getCriterionCode(item, index);
                      const title = getCriterionTitle(item, index);
                      const score = item.score ?? item.raw_score ?? item.value ?? null;
                      return (
                        <tr key={`${code}-${index}`}>
                          <td style={styles.td}>{code}</td>
                          <td style={styles.td}>{title}</td>
                          <td style={styles.tdRight}>{formatScore(score)}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section style={styles.section}>
            <h3 style={styles.sectionTitle}>Overall Evidence / Additional Details</h3>
            <div style={styles.textBlock}>
              {overallEvidence && String(overallEvidence).trim()
                ? overallEvidence
                : "No additional details provided."}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function Navbar({ theme, onLogoClick, onDownloadPDF, downloading }) {
  return (
    <header style={{ ...styles.navbar, background: theme.navBg, borderBottom: `1px solid ${theme.border}` }}>
      <div style={styles.navInner}>
        <button onClick={onLogoClick} style={styles.logoButton}>
          <img src={logo} alt="SME Scoring" style={styles.logoImg} />
          <div style={styles.logoTextWrap}>
            <div style={{ ...styles.logoTitle, color: theme.text }}>SME Scoring</div>
            <div style={{ ...styles.logoSubtitle, color: theme.muted }}>Decision Support Platform</div>
          </div>
        </button>
        <div style={styles.navActions}>
          <button
            type="button"
            onClick={onDownloadPDF}
            disabled={downloading}
            style={{
              ...styles.downloadBtn,
              background: theme.button,
              color: "#FFFFFF",
              opacity: downloading ? 0.7 : 1,
              cursor: downloading ? "not-allowed" : "pointer",
            }}
          >
            {downloading ? "Downloading..." : "Download PDF"}
          </button>
        </div>
      </div>
    </header>
  );
}

const BRAND = "#2F96B4";
const darkTheme = {
  bg: "#0B1220", card: "#172033", text: "#FFFFFF", muted: "rgba(255,255,255,0.72)",
  border: "rgba(255,255,255,0.10)", button: BRAND, navBg: "#101828",
};
const lightTheme = {
  bg: "#F6F8FB", card: "#FFFFFF", text: "#0F172A", muted: "rgba(15,23,42,0.68)",
  border: "rgba(15,23,42,0.10)", button: BRAND, navBg: "#FFFFFF",
};

const styles = {
  page: appShellStyles.page,
  navbar: { position: "sticky", top: 0, zIndex: 50, width: "100%" },
  navInner: {
    ...appNavbarStyles.navInner,
    padding: "14px 0",
  },
  logoButton: appNavbarStyles.logoButton,
  logoImg: appNavbarStyles.logoImg,
  logoTextWrap: { ...appNavbarStyles.brandTextWrap, alignItems: "flex-start" },
  logoTitle: { ...appNavbarStyles.brandTitle, lineHeight: 1.1 },
  logoSubtitle: { ...appNavbarStyles.brandSub, fontSize: 14 },
  navActions: { display: "flex", alignItems: "center", gap: 14 },
  downloadBtn: { border: "none", borderRadius: 10, padding: "12px 18px", fontSize: 14, fontWeight: 700 },
  wrapper: { width: "min(1180px, calc(100% - 28px))", margin: "0 auto", padding: "clamp(18px, 5vw, 28px) 0 40px" },
  messageBox: { maxWidth: 520, margin: "120px auto", padding: 24, borderRadius: 16, textAlign: "center", fontSize: 18 },
  reportSheet: { borderRadius: 20, padding: "clamp(18px, 5vw, 34px)", boxShadow: "0 10px 28px rgba(0,0,0,0.06)" },
  reportHeader: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 20, borderBottom: "1px solid rgba(127,127,127,0.18)", paddingBottom: 22, marginBottom: 28, flexWrap: "wrap" },
  reportTitle: { fontSize: "clamp(22px, 6vw, 30px)", fontWeight: 800, marginBottom: 6 },
  reportSubtitle: { fontSize: 14, opacity: 0.75 },
  scoreBox: { minWidth: 170, padding: 18, borderRadius: 14, background: "rgba(47,150,180,0.08)", textAlign: "center" },
  scoreBoxLabel: { fontSize: 13, opacity: 0.75, marginBottom: 8 },
  scoreBoxValue: { fontSize: 30, fontWeight: 800 },
  section: { marginBottom: 30 },
  sectionTitle: { fontSize: 21, fontWeight: 800, margin: "0 0 16px 0" },
  infoTable: { border: "1px solid rgba(127,127,127,0.18)", borderRadius: 14, overflow: "hidden" },
  infoRow: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(220px, 100%), 1fr))", borderBottom: "1px solid rgba(127,127,127,0.12)" },
  infoLabel: { padding: "14px 16px", fontWeight: 700, background: "rgba(127,127,127,0.06)" },
  infoValue: { padding: "14px 16px" },
  tableWrap: { overflowX: "auto", border: "1px solid rgba(127,127,127,0.18)", borderRadius: 14 },
  table: { width: "100%", borderCollapse: "collapse" },
  th: { textAlign: "left", padding: "14px 16px", fontSize: 14, background: "rgba(127,127,127,0.08)", borderBottom: "1px solid rgba(127,127,127,0.18)" },
  thRight: { textAlign: "right", padding: "14px 16px", fontSize: 14, background: "rgba(127,127,127,0.08)", borderBottom: "1px solid rgba(127,127,127,0.18)" },
  td: { padding: "14px 16px", borderBottom: "1px solid rgba(127,127,127,0.10)", fontSize: 15 },
  tdRight: { padding: "14px 16px", borderBottom: "1px solid rgba(127,127,127,0.10)", fontSize: 15, textAlign: "right", fontWeight: 700 },
  textBlock: { border: "1px solid rgba(127,127,127,0.18)", borderRadius: 14, padding: 18, lineHeight: 1.7, whiteSpace: "pre-wrap", background: "rgba(127,127,127,0.04)", fontSize: 15 },
};
