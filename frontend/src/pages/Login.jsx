import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { authPageStyles, getAuthTheme } from "../styles/authStyles";
import { API_BASE_URL } from "../config/api";

export default function Login() {
  const navigate = useNavigate();

  // Fixed: theme read inside useState so it doesn't freeze on mount
  const [dark] = useState(() => localStorage.getItem("theme") === "dark");
  const theme = getAuthTheme(dark, {
    muted: dark ? "rgba(255,255,255,0.7)" : "#64748B",
  });

  const [form, setForm] = useState({ username: "", password: "" });
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  function onChange(e) {
    const { name, value } = e.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  }

  async function onSubmit(e) {
    e.preventDefault();
    setErr("");
    setLoading(true);

    localStorage.removeItem("token");
    localStorage.removeItem("role");
    localStorage.removeItem("username");
    localStorage.removeItem("bank_name");
    localStorage.removeItem("bank_code");

    try {
      const res = await fetch(`${API_BASE_URL}/api/login/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: form.username.trim(),
          password: form.password,
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data.detail || "Login failed.");
      }

      localStorage.setItem("token", data.token || "");
      localStorage.setItem("role", data.role || "");
      localStorage.setItem("username", data.username || "");
      localStorage.setItem("bank_name", data.bank_name || "");
      localStorage.setItem("bank_code", data.bank_code || "");

      if (data.role === "SUPER_ADMIN") {
        navigate("/super-admin");
      } else if (data.role === "BANK_ADMIN") {
        navigate("/bank-admin-dashboard");
      } else {
        navigate("/evaluator-home");
      }
    } catch (error) {
      localStorage.removeItem("token");
      localStorage.removeItem("role");
      localStorage.removeItem("username");
      localStorage.removeItem("bank_name");
      localStorage.removeItem("bank_code");
      setErr(error.message || "Login failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ ...styles.page, background: theme.bg }}>
      <div
        style={{
          ...styles.card,
          background: theme.card,
          border: `1px solid ${theme.border}`,
        }}
      >
        <h1 style={{ ...styles.title, color: theme.text }}>Evaluator Login</h1>
        <p style={{ ...styles.subtitle, color: theme.muted }}>
          Sign in with your evaluator account.
        </p>

        <form onSubmit={onSubmit} style={styles.form}>
          <input
            name="username"
            placeholder="Username"
            value={form.username}
            onChange={onChange}
            autoComplete="username"
            style={{
              ...styles.input,
              background: theme.inputBg,
              color: theme.text,
              border: `1px solid ${theme.border}`,
            }}
            required
          />

          <input
            type="password"
            name="password"
            placeholder="Password"
            value={form.password}
            onChange={onChange}
            autoComplete="current-password"
            style={{
              ...styles.input,
              background: theme.inputBg,
              color: theme.text,
              border: `1px solid ${theme.border}`,
            }}
            required
          />

          <button
            disabled={loading}
            style={{ ...styles.button, background: theme.primary }}
          >
            {loading ? "Signing in..." : "Login"}
          </button>

          {err && <div style={{ ...styles.error, color: theme.errorText }}>{err}</div>}

          <button type="button" onClick={() => navigate("/")} style={styles.link}>
            Back to Home
          </button>

          <button
            type="button"
            onClick={() => navigate("/signup")}
            style={styles.link}
          >
            New evaluator? Create an account
          </button>
        </form>
      </div>
    </div>
  );
}

const styles = {
  page: authPageStyles.page,
  card: {
    ...authPageStyles.card,
    maxWidth: 420,
    borderRadius: 16,
    boxShadow: "0 20px 40px rgba(0,0,0,0.12)",
  },
  title: {
    marginBottom: 8,
    fontSize: 28,
    fontWeight: 700,
  },
  subtitle: {
    marginBottom: 20,
    fontSize: 15,
  },
  form: authPageStyles.form,
  input: authPageStyles.input,
  button: authPageStyles.button,
  link: { ...authPageStyles.link, color: "#2F96B4" },
  error: authPageStyles.error,
};
