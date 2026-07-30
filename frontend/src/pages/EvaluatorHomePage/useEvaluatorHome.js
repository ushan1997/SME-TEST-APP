import { useCallback, useEffect, useRef, useState } from "react";
import { API_BASE_URL } from "../../config/api";

export function useEvaluatorHome(navigate) {
  const role = localStorage.getItem("role");
  const [themeMode] = useState(() => {
    const saved = localStorage.getItem("theme");
    return saved === "light" ? "light" : "dark";
  });
  const [activeTab, setActiveTab] = useState("home");
  const [summary, setSummary] = useState({ total_smes: 0, scored_smes: 0, pending_smes: 0 });
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [homeSearch, setHomeSearch] = useState("");
  const [homeFound, setHomeFound] = useState(null);
  const [homeSearchMsg, setHomeSearchMsg] = useState("");
  const [scoreSearch, setScoreSearch] = useState("");
  const [scoreFound, setScoreFound] = useState(null);
  const [scoreSearchMsg, setScoreSearchMsg] = useState("");
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [passwordForm, setPasswordForm] = useState({ old_password: "", new_password: "", confirm_password: "" });
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordMsg, setPasswordMsg] = useState("");
  const profileRef = useRef(null);
  const notifyRef = useRef(null);
  const username = localStorage.getItem("username") || "Evaluator";

  const authHeaders = useCallback((extra = {}) => {
    return { Authorization: `Token ${localStorage.getItem("token")}`, ...extra };
  }, []);

  const loadNotifications = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/evaluator/notifications/`, { headers: authHeaders() });
      if (res.status === 401) {
        localStorage.clear();
        navigate("/login");
        return;
      }
      const data = await res.json().catch(() => []);
      const items = (Array.isArray(data) ? data : []).filter(
        (item) => !["Account Blocked", "Account Unblocked"].includes(item.title)
      );
      setNotifications(items);
      setUnreadCount(items.filter((n) => !n.is_read).length);
    } catch (e) {
      console.error("Failed to load notifications:", e);
    }
  }, [authHeaders, navigate]);

  async function markNotificationsAsRead() {
    try {
      await fetch(`${API_BASE_URL}/api/evaluator/notifications/mark-read/`, {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
      });
      setNotifications((prev) => prev.map((item) => ({ ...item, is_read: true })));
      setUnreadCount(0);
    } catch (e) {
      console.error("Failed to mark notifications as read:", e);
    }
  }

  const loadData = useCallback(async () => {
    setLoading(true);
    setErr("");
    const tokenNow = localStorage.getItem("token");
    if (!tokenNow) {
      setErr("You are not logged in.");
      setLoading(false);
      navigate("/login");
      return;
    }
    if (role === "BANK_ADMIN") {
      navigate("/bank-admin-dashboard");
      return;
    }
    try {
      const res = await fetch(`${API_BASE_URL}/api/evaluator/summary/`, { headers: authHeaders() });
      const sum = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(sum.detail || "Failed to load summary.");
      setSummary({
        total_smes: sum.total_smes || 0,
        scored_smes: sum.scored_smes || 0,
        pending_smes: sum.pending_smes || 0,
      });
      await loadNotifications();
    } catch (e) {
      setErr(e.message || "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }, [authHeaders, loadNotifications, navigate, role]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadData();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadData]);

  useEffect(() => {
    function handleClickOutside(event) {
      if (profileRef.current && !profileRef.current.contains(event.target)) setShowProfileMenu(false);
      if (notifyRef.current && !notifyRef.current.contains(event.target)) setShowNotifications(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  async function searchHomeByBR() {
    setHomeSearchMsg("");
    setHomeFound(null);
    if (!localStorage.getItem("token")) {
      setHomeSearchMsg("You are not logged in.");
      navigate("/login");
      return;
    }
    if (!homeSearch.trim()) {
      setHomeSearchMsg("Please enter a BR number.");
      return;
    }
    try {
      const res = await fetch(`${API_BASE_URL}/api/smes/report-by-br/?br=${encodeURIComponent(homeSearch.trim())}`, { headers: authHeaders() });
      if (res.status === 401) {
        localStorage.clear();
        navigate("/login");
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setHomeSearchMsg(data.detail || "Scoring has not been done. Please go to the Scoring part and start scoring.");
        return;
      }
      setHomeFound(data);
      setHomeSearchMsg("Completed SME report found.");
    } catch (e) {
      setHomeSearchMsg(e.message || "Search failed.");
    }
  }

  async function searchScoreByBR() {
    setScoreSearchMsg("");
    setScoreFound(null);
    if (!localStorage.getItem("token")) {
      setScoreSearchMsg("You are not logged in.");
      navigate("/login");
      return;
    }
    if (!scoreSearch.trim()) {
      setScoreSearchMsg("Please enter a BR number.");
      return;
    }
    try {
      const res = await fetch(`${API_BASE_URL}/api/smes/scoring-by-br/?br=${encodeURIComponent(scoreSearch.trim())}`, { headers: authHeaders() });
      if (res.status === 401) {
        localStorage.clear();
        navigate("/login");
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setScoreSearchMsg(data.detail || "Search failed.");
        return;
      }
      setScoreFound(data);
      setScoreSearchMsg("SME found. You can continue scoring.");
    } catch (e) {
      setScoreSearchMsg(e.message || "Search failed.");
    }
  }

  function handleLogout() {
    localStorage.clear();
    navigate("/");
  }

  function openPasswordModal() {
    setShowProfileMenu(false);
    setPasswordMsg("");
    setShowPasswordModal(true);
    setPasswordForm({ old_password: "", new_password: "", confirm_password: "" });
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
      const res = await fetch(`${API_BASE_URL}/api/change-password/`, {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          old_password: passwordForm.old_password,
          new_password: passwordForm.new_password,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || "Failed to change password.");
      setPasswordMsg("Password changed successfully.");
      setTimeout(() => {
        setShowPasswordModal(false);
        localStorage.clear();
        navigate("/login");
      }, 1200);
    } catch (e) {
      setPasswordMsg(e.message || "Failed to change password.");
    } finally {
      setPasswordSaving(false);
    }
  }

  return {
    themeMode, activeTab, setActiveTab, summary, loading, err, homeSearch, setHomeSearch, homeFound,
    homeSearchMsg, scoreSearch, setScoreSearch, scoreFound, scoreSearchMsg, showProfileMenu,
    setShowProfileMenu, showNotifications, setShowNotifications, showPasswordModal, setShowPasswordModal,
    notifications, unreadCount, profileRef, notifyRef, passwordForm, passwordSaving, passwordMsg,
    username, markNotificationsAsRead, searchHomeByBR, searchScoreByBR, handleLogout, openPasswordModal,
    handlePasswordInput, handleChangePassword,
  };
}
