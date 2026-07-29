import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { authPageStyles, getAuthTheme } from "../styles/authStyles";
import { API_BASE_URL } from "../config/api";

export default function Signup() {
  const navigate = useNavigate();

  // Fixed: theme read inside useState so it doesn't freeze on mount
  const [dark] = useState(() => localStorage.getItem("theme") === "dark");
  const theme = getAuthTheme(dark, {
    muted: dark ? "rgba(255,255,255,0.75)" : "#64748B",
    card: dark ? "#172033" : "#FFFFFF",
    shadow: dark
      ? "0 16px 32px rgba(0,0,0,0.18)"
      : "0 16px 32px rgba(15,23,42,0.08)",
  });

  const [form, setForm] = useState({
    bank_code: "",
    username: "",
    password: "",
    confirm: "",
  });
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [modal, setModal] = useState(null);
  const [loading, setLoading] = useState(false);

  function onChange(e) {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  }

  function extractErrorMessage(data) {
    if (!data) return "Signup failed.";
    if (typeof data.detail === "string") return data.detail;
    if (typeof data === "object") {
      for (const value of Object.values(data)) {
        if (Array.isArray(value) && value.length > 0) return String(value[0]);
        if (typeof value === "string") return value;
      }
    }
    return "Signup failed.";
  }

  async function onSubmit(e) {
    e.preventDefault();
    setMsg("");
    setErr("");
    setModal(null);

    if (!form.bank_code.trim()) { setErr("Bank code is required."); return; }
    if (!form.username.trim()) { setErr("Username is required."); return; }
    if (form.password.length < 8) { setErr("Password must be at least 8 characters."); return; }
    if (form.password !== form.confirm) { setErr("Passwords do not match."); return; }

    setLoading(true);

    try {
      const res = await fetch(`${API_BASE_URL}/api/signup/evaluator/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bank_code: form.bank_code.trim(),
          username: form.username.trim(),
          password: form.password,
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(extractErrorMessage(data));
      }

      setMsg(
        "Account created successfully. Waiting for bank admin approval. Redirecting to login in 4 seconds..."
      );

      // Fixed: was 1800ms — gives user time to actually read the message
      setTimeout(() => navigate("/login"), 4000);
    } catch (error) {
      const message = error.message || "Signup failed.";
      setErr(message);
      if (message.toLowerCase().includes("renew your software")) {
        setModal(message);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ ...styles.page, background: theme.bg, color: theme.text }}>
      <div
        style={{
          ...styles.card,
          background: theme.card,
          border: `1px solid ${theme.border}`,
          boxShadow: theme.shadow,
        }}
      >
        <h1 style={{ ...styles.title, color: theme.text }}>Evaluator Signup</h1>
        <p style={{ ...styles.note, color: theme.muted }}>
          Enter the correct bank code. Your account will be created as pending
          until the bank admin approves it.
        </p>

        <form onSubmit={onSubmit} style={styles.form}>
          <input
            name="bank_code"
            value={form.bank_code}
            onChange={onChange}
            placeholder="Bank code"
            required
            style={{
              ...styles.input,
              background: theme.inputBg,
              color: theme.text,
              border: `1px solid ${theme.border}`,
            }}
          />

          <input
            name="username"
            value={form.username}
            onChange={onChange}
            placeholder="Username"
            autoComplete="username"
            required
            style={{
              ...styles.input,
              background: theme.inputBg,
              color: theme.text,
              border: `1px solid ${theme.border}`,
            }}
          />

          <input
            type="password"
            name="password"
            value={form.password}
            onChange={onChange}
            placeholder="Password (min 8 characters)"
            autoComplete="new-password"
            required
            style={{
              ...styles.input,
              background: theme.inputBg,
              color: theme.text,
              border: `1px solid ${theme.border}`,
            }}
          />

          <input
            type="password"
            name="confirm"
            value={form.confirm}
            onChange={onChange}
            placeholder="Confirm password"
            autoComplete="new-password"
            required
            style={{
              ...styles.input,
              background: theme.inputBg,
              color: theme.text,
              border: `1px solid ${theme.border}`,
            }}
          />

          <button
            disabled={loading}
            style={{ ...styles.button, background: theme.primary }}
          >
            {loading ? "Creating account..." : "Create account"}
          </button>

          {msg && <div style={styles.success}>{msg}</div>}
          {err && <div style={{ ...styles.error, color: theme.errorText }}>{err}</div>}

          {/* Manual navigate button stays available even after success */}
          <button
            type="button"
            onClick={() => navigate("/login")}
            style={styles.link}
          >
            Already have an account? Login
          </button>
          <button
            type="button"
            onClick={() => navigate("/")}
            style={styles.link}
          >
            Back to Home
          </button>
        </form>
      </div>
      {modal && (
        <div style={styles.modalOverlay}>
          <div style={{ ...styles.modalBox, background: theme.card, color: theme.text, border: `1px solid ${theme.border}` }}>
            <div style={{ fontWeight: 800, fontSize: 20 }}>Renew Your Software</div>
            <div style={{ marginTop: 10, color: theme.muted }}>{modal}</div>
            <button type="button" onClick={() => setModal(null)} style={{ ...styles.button, marginTop: 16, background: theme.primary }}>
              OK
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const styles = {
  page: authPageStyles.page,
  card: {
    ...authPageStyles.card,
    maxWidth: 460,
  },
  title: {
    marginBottom: 10,
    fontSize: 32,
    fontWeight: 700,
  },
  note: {
    marginBottom: 20,
    fontSize: 14,
    lineHeight: 1.6,
  },
  form: authPageStyles.form,
  input: { ...authPageStyles.input, fontSize: 14 },
  button: authPageStyles.button,
  link: { ...authPageStyles.link, color: "#2F96B4" },
  error: authPageStyles.error,
  success: authPageStyles.success,
  modalOverlay: {
    position: "fixed",
    inset: 0,
    zIndex: 200,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
    background: "rgba(2,6,23,0.62)",
  },
  modalBox: {
    width: "min(380px, 100%)",
    borderRadius: 16,
    padding: 22,
    textAlign: "center",
    boxShadow: "0 24px 70px rgba(0,0,0,0.28)",
  },
};
