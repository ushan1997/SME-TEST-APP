import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { createAppTheme } from "../../styles/appTheme";
import CriteriaSidebar from "./CriteriaSidebar";
import CriterionEditor from "./CriterionEditor";
import { createEmptyScores, rubric } from "./constants";
import ScoringHeader from "./ScoringHeader";
import { styles } from "./styles";
import { darkTheme, lightTheme } from "./theme";
import { API_BASE_URL } from "../../config/api";

export default function ScoringPage() {
  const navigate = useNavigate();
  const { id } = useParams();
  const token = localStorage.getItem("token") || "";
  const [dark] = useState(() => (localStorage.getItem("theme") ? localStorage.getItem("theme") === "dark" : true));
  const [sme, setSme] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [renewalNotice, setRenewalNotice] = useState("");
  const [savingDraft, setSavingDraft] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [scores, setScores] = useState(() => createEmptyScores());
  const cardRef = useRef(null);

  useEffect(() => {
    document.body.style.margin = "0";
    localStorage.setItem("theme", dark ? "dark" : "light");
  }, [dark]);

  const theme = useMemo(() => createAppTheme(dark, dark ? darkTheme : lightTheme), [dark]);

  const progress = useMemo(() => {
    const scored = Object.values(scores).filter((value) => typeof value.score === "number").length;
    return { scored, total: rubric.length };
  }, [scores]);

  const goToIndex = (index) => {
    const safeIndex = Math.max(0, Math.min(rubric.length - 1, index));
    setActiveIndex(safeIndex);
    setTimeout(() => cardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  };

  useEffect(() => {
    if (!token) {
      navigate("/login", { replace: true });
      return;
    }

    async function loadAll() {
      setLoading(true);
      setError("");

      try {
        const smeRes = await fetch(`${API_BASE_URL}/api/smes/${id}/`, {
          headers: { Authorization: `Token ${token}` },
        });
        const smeData = await smeRes.json().catch(() => ({}));

        if (smeRes.status === 401) {
          localStorage.removeItem("token");
          navigate("/login", { replace: true });
          return;
        }
        if (!smeRes.ok) throw new Error(smeData.detail || "Failed to load SME.");
        setSme(smeData);

        const scoreRes = await fetch(`${API_BASE_URL}/api/smes/${id}/criterion-scores/`, {
          headers: { Authorization: `Token ${token}` },
        });
        const scoreData = await scoreRes.json().catch(() => ({}));

        if (scoreRes.status === 401) {
          localStorage.removeItem("token");
          navigate("/login", { replace: true });
          return;
        }
        if (!scoreRes.ok) throw new Error(scoreData.detail || "Failed to load saved scores.");

        setScores((previous) => {
          const next = { ...previous };
          for (const row of scoreData.scores || []) {
            if (!row?.code || !(row.code in next)) continue;
            next[row.code] = {
              score: typeof row.score === "number" ? row.score : row.score ?? null,
              notes: row.notes ?? "",
              followup: !!row.followup,
            };
          }
          return next;
        });
      } catch (loadError) {
        setError(loadError.message || "Failed to load data.");
      } finally {
        setLoading(false);
      }
    }

    loadAll();
  }, [id, token, navigate]);

  async function saveDraftToBackend() {
    if (!token) return false;

    setSavingDraft(true);
    setError("");

    try {
      const payload = rubric.map((criterion) => ({
        code: criterion.code,
        score: scores[criterion.code]?.score ?? null,
        notes: scores[criterion.code]?.notes ?? "",
        followup: !!scores[criterion.code]?.followup,
      }));

      const response = await fetch(`${API_BASE_URL}/api/smes/${id}/criterion-scores/`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Token ${token}`,
        },
        body: JSON.stringify({ scores: payload }),
      });
      const data = await response.json().catch(() => ({}));

      if (response.status === 401) {
        localStorage.removeItem("token");
        navigate("/login", { replace: true });
        return false;
      }
      if (!response.ok) throw new Error(data.detail || "Failed to save draft.");
      return true;
    } catch (saveError) {
      setError(saveError.message || "Failed to save draft.");
      return false;
    } finally {
      setSavingDraft(false);
    }
  }

  async function submitFinal() {
    if (progress.scored !== progress.total) {
      setError("Please score all criteria before submitting.");
      return;
    }

    setSubmitting(true);
    setError("");
    setRenewalNotice("");

    try {
      const saved = await saveDraftToBackend();
      if (!saved) return;

      const response = await fetch(`${API_BASE_URL}/api/smes/${id}/submit-capability/`, {
        method: "POST",
        headers: { Authorization: `Token ${token}` },
      });
      const data = await response.json().catch(() => ({}));

      if (response.status === 401) {
        localStorage.removeItem("token");
        navigate("/login", { replace: true });
        return;
      }
      if (!response.ok) throw new Error(data.detail || "Submit failed.");

      navigate("/evaluator-home", { state: { activeTab: "scoring" } });
    } catch (submitError) {
      const message = submitError.message || "Submit failed.";
      if (message.toLowerCase().includes("renew your software")) {
        setRenewalNotice(message);
      }
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ ...styles.page, background: theme.bg, color: theme.text }}>
      <ScoringHeader theme={theme} styles={styles} navigate={navigate} />

      <section style={styles.pageHero}>
        <div style={{ ...styles.heroGlow, background: theme.heroGlow }} />
        <div style={styles.main}>
          <div style={styles.sectionHeader}>
            <h1 style={{ ...styles.sectionTitle, color: theme.subText }}>
              {loading ? "Loading SME..." : `BR number: ${sme?.br_number || "-"}`}<br />
              {`SME Name: ${sme?.name || "-"}`}<br />
              {`Industry: ${sme?.industry || "-"}`}
            </h1>
          </div>

          {error && (
            <div
              style={{
                ...styles.alert,
                background: theme.errorBg,
                color: theme.errorText,
                border: `1px solid ${theme.errorBorder}`,
              }}
            >
              {error}
            </div>
          )}
        </div>
      </section>

      <main style={styles.main}>
        <div style={styles.scoringLayout}>
          <CriteriaSidebar theme={theme} styles={styles} scores={scores} activeIndex={activeIndex} goToIndex={goToIndex} />
          <CriterionEditor
            theme={theme}
            styles={styles}
            activeIndex={activeIndex}
            scores={scores}
            setScores={setScores}
            goToIndex={goToIndex}
            cardRef={cardRef}
            progress={progress}
            saveDraftToBackend={saveDraftToBackend}
            savingDraft={savingDraft}
            submitFinal={submitFinal}
            submitting={submitting}
          />
        </div>
      </main>

      <footer style={{ ...styles.footer, color: theme.subText, borderTop: `1px solid ${theme.border}` }}>
        <div>Copyright {new Date().getFullYear()} SME Scoring Platform</div>
      </footer>
      {renewalNotice && (
        <div style={styles.modalOverlay}>
          <div style={{ ...styles.modalCard, background: theme.card, color: theme.text, border: `1px solid ${theme.border}` }}>
            <div style={styles.modalTitle}>Renew Your Software</div>
            <div style={{ marginTop: 10, color: theme.subText, lineHeight: 1.6 }}>{renewalNotice}</div>
            <button type="button" style={{ ...styles.primaryBtn, marginTop: 16, background: theme.button, color: theme.buttonText }} onClick={() => setRenewalNotice("")}>
              OK
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
