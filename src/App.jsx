import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft, Bell, BookOpen, CalendarDays, Check, ChevronRight, Clock3, Eye, EyeOff, Grid2X2, House,
  Mail, Menu, MessageCircle, Pencil, Plus, Search, Send, Settings2, Sparkles, Upload, UserRound, Users, X,
} from "lucide-react";

const dayOrders = [1, 2, 3, 4, 5, 6];
const cohorts = ["AMCA", "NMCA"];
const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/+$/, "");
function todayInCollegeTimezone() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const part = (type) => parts.find((item) => item.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
const navigation = [
  { id: "overview", label: "Overview", Icon: Grid2X2 },
  { id: "student", label: "Student timetable", Icon: CalendarDays },
  { id: "faculty", label: "Faculty timetable", Icon: BookOpen },
  { id: "people", label: "People", Icon: Users },
  { id: "messages", label: "Email activity", Icon: Mail },
  { id: "profile", label: "Profile", Icon: UserRound },
];

function parseRosterCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  const source = text.replace(/^\uFEFF/, "");
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted && character === '"' && source[index + 1] === '"') {
      field += '"';
      index += 1;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (character === "," && !quoted) {
      row.push(field.trim());
      field = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      row.push(field.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      field = "";
      if (character === "\r" && source[index + 1] === "\n") index += 1;
    } else {
      field += character;
    }
  }
  if (quoted) throw new Error("The CSV has an unclosed quoted field.");
  row.push(field.trim());
  if (row.some(Boolean)) rows.push(row);
  if (rows.length < 2) throw new Error("The CSV needs a header row and at least one contact.");
  const headers = rows[0].map((header) => header.trim().toLowerCase());
  const required = ["name", "email", "role", "group_name"];
  const columns = required.map((header) => headers.indexOf(header));
  if (columns.some((column) => column < 0)) {
    throw new Error("CSV headers must be name,email,role,group_name.");
  }
  return rows.slice(1).map((cells, index) => {
    const [name, email, role, group_name] = columns.map((column) => cells[column] || "");
    if (!name || !email || !role || !group_name) {
      throw new Error(`CSV row ${index + 2} is missing a required value.`);
    }
    return { name, email: email.toLowerCase(), role, group_name, email_opt_in: true };
  });
}

async function api(path, options) {
  const token = sessionStorage.getItem("daybook-hod-token");
  const headers = { "Content-Type": "application/json", ...options?.headers };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${apiBaseUrl}/api${path}`, {
    headers,
    ...options,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const error = new Error(typeof body.detail === "string" ? body.detail : `Request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return response.status === 204 ? null : response.json();
}

function formatTime(value) {
  const [hour, minute] = value.split(":").map(Number);
  const suffix = hour >= 12 ? "PM" : "AM";
  return `${hour % 12 || 12}:${String(minute).padStart(2, "0")} ${suffix}`;
}

function initials(name) {
  return name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

function PasswordField({ label, name, autoComplete, maxLength = 128, required = true, placeholder }) {
  const [visible, setVisible] = useState(false);
  return (
    <label className="password-field">
      {label}
      <span className="password-input-wrap">
        <input
          name={name}
          type={visible ? "text" : "password"}
          autoComplete={autoComplete}
          maxLength={maxLength}
          required={required}
          placeholder={placeholder}
        />
        <button
          className="password-visibility"
          type="button"
          onClick={() => setVisible((current) => !current)}
          aria-label={visible ? "Hide password" : "Show password"}
          aria-pressed={visible}
        >
          {visible ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </span>
    </label>
  );
}

function App() {
  const [view, setView] = useState("overview");
  const [canGoBack, setCanGoBack] = useState(false);
  const pageHistory = useRef([]);
  const [order, setOrder] = useState(3);
  const [currentOrder, setCurrentOrder] = useState(1);
  const [cohort, setCohort] = useState("AMCA");
  const [schedules, setSchedules] = useState({ AMCA: [], NMCA: [] });
  const [people, setPeople] = useState([]);
  const [messages, setMessages] = useState([]);
  const [automation, setAutomation] = useState({ enabled: false, configured: false, ready: false, last_run: null });
  const [token, setToken] = useState(() => sessionStorage.getItem("daybook-hod-token"));
  const [hod, setHod] = useState(() => {
    const name = sessionStorage.getItem("daybook-hod-name");
    const email = sessionStorage.getItem("daybook-hod-email");
    return name && email ? { name, email, role: "HOD" } : null;
  });
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [settings, setSettings] = useState({
    college_name: "Northfield College",
    current_day_order: 1,
    anchor_date: todayInCollegeTimezone(),
    anchor_day_order: 1,
    reminder_time: "07:00",
    reminder_enabled: true,
  });
  const [filter, setFilter] = useState("Everyone");
  const [search, setSearch] = useState("");
  const [customAudience, setCustomAudience] = useState("students");
  const [customCohort, setCustomCohort] = useState("AMCA");
  const [customSubject, setCustomSubject] = useState("");
  const [customMessage, setCustomMessage] = useState("");
  const [customBusy, setCustomBusy] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const rosterFileInput = useRef(null);
  const [modal, setModal] = useState("");
  const [toast, setToast] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [mobileMenu, setMobileMenu] = useState(false);
  const [editingPeriod, setEditingPeriod] = useState(null);
  const [editingPerson, setEditingPerson] = useState(null);
  const [personRole, setPersonRole] = useState("Student");

  const loadData = useCallback(async (selectedOrder) => {
    setError("");
    try {
      const [amcaOrders, nmcaOrders, nextPeople, nextMessages, nextSettings, nextAutomation] = await Promise.all([
        Promise.all(dayOrders.map((day) => api(`/day-orders/${day}?cohort=AMCA`))),
        Promise.all(dayOrders.map((day) => api(`/day-orders/${day}?cohort=NMCA`))),
        api("/people"),
        api("/messages"),
        api("/settings"),
        api("/messages/automation"),
      ]);
      setPeople(nextPeople);
      setMessages(nextMessages);
      setSettings(nextSettings);
      setAutomation(nextAutomation);
      const targetOrder = selectedOrder ?? nextSettings.current_day_order;
      setOrder(targetOrder);
      setCurrentOrder(nextSettings.current_day_order);
      setSchedules({ AMCA: amcaOrders, NMCA: nmcaOrders });
    } catch (requestError) {
      if (requestError.status === 401) {
        sessionStorage.removeItem("daybook-hod-token");
        sessionStorage.removeItem("daybook-hod-name");
        sessionStorage.removeItem("daybook-hod-email");
        setToken(null);
        setHod(null);
        return;
      }
      setError(requestError.message);
    }
  }, []);

  useEffect(() => {
    if (!token) return undefined;
    let active = true;
    api("/auth/me")
      .then((user) => {
        if (active) {
          setHod(user);
          sessionStorage.setItem("daybook-hod-name", user.name);
          sessionStorage.setItem("daybook-hod-email", user.email);
          loadData();
        }
      })
      .catch((requestError) => {
        if (active && requestError.status === 401) {
          sessionStorage.removeItem("daybook-hod-token");
          sessionStorage.removeItem("daybook-hod-name");
          sessionStorage.removeItem("daybook-hod-email");
          setToken(null);
          setHod(null);
        } else if (active) {
          setError(`Could not connect to the timetable server. Check that the backend is running, then retry. ${requestError.message}`);
        }
      });
    return () => { active = false; };
  }, [loadData, token]);

  useEffect(() => {
    if (!token) return undefined;
    const timer = window.setInterval(async () => {
      try {
        const latest = await api("/settings");
        const latestAutomation = await api("/messages/automation");
        setSettings(latest);
        setAutomation(latestAutomation);
        if (latest.current_day_order !== currentOrder) {
          setCurrentOrder(latest.current_day_order);
          if (order === currentOrder) setOrder(latest.current_day_order);
          const [amcaOrders, nmcaOrders] = await Promise.all([
            Promise.all(dayOrders.map((day) => api(`/day-orders/${day}?cohort=AMCA`))),
            Promise.all(dayOrders.map((day) => api(`/day-orders/${day}?cohort=NMCA`))),
          ]);
          setSchedules({ AMCA: amcaOrders, NMCA: nmcaOrders });
        }
      } catch {
        // The next poll retries; the main data load reports API errors.
      }
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [currentOrder, order, token]);
  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(""), 3000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const activePeople = useMemo(() => people.filter((person) => {
    const matchesRole = filter === "Everyone" || person.role === filter.slice(0, -1);
    const term = search.trim().toLowerCase();
    const matchesSearch = !term || `${person.name} ${person.group_name} ${person.email}`.toLowerCase().includes(term);
    return matchesRole && matchesSearch;
  }), [filter, people, search]);
  const students = people.filter((person) => person.role === "Student");
  const studentsByCohort = Object.fromEntries(
    cohorts.map((item) => [item, students.filter((person) => person.group_name === item)]),
  );
  const verifiedStudentsByCohort = Object.fromEntries(
    cohorts.map((item) => [item, students.filter((person) => person.group_name === item && person.email_opt_in && !person.is_sample).length]),
  );
  const teachers = people.filter((person) => person.role === "Teacher");
  const verifiedStudents = students.filter((person) => person.email_opt_in && !person.is_sample).length;
  const verifiedTeachers = teachers.filter((person) => person.email_opt_in && !person.is_sample).length;
  const scheduledTeacherNames = new Set(
    cohorts.flatMap((item) => schedules[item][order - 1] || [])
      .map((period) => period.teacher_name.trim().toLowerCase()),
  );
  const verifiedScheduledTeachers = teachers.filter((person) => (
    person.email_opt_in
    && !person.is_sample
    && scheduledTeacherNames.has(person.name.trim().toLowerCase())
  )).length;
  const customRecipients = people.filter((person) => (
    person.role === (customAudience === "students" ? "Student" : "Teacher")
    && (customAudience !== "students" || person.group_name === customCohort)
    && person.is_active
    && person.email_opt_in
    && !person.is_sample
  ));
  const automationLabel = !automation.ready
    ? "Gmail not configured"
    : !automation.daily_enabled
      ? "Custom email only"
      : !settings.reminder_enabled
    ? "Paused"
      : "Scheduled";
  const schedule = schedules[cohort]?.[order - 1] || [];
  const otherCohortSchedule = schedules[cohort === "AMCA" ? "NMCA" : "AMCA"]?.[order - 1] || [];
  const todaySchedule = schedules[cohort]?.[currentOrder - 1] || [];
  const scheduledHours = todaySchedule.reduce((total, period) => total + period.duration_hours, 0);
  const date = new Intl.DateTimeFormat("en", { weekday: "long", month: "long", day: "numeric" }).format(new Date());
  const title = navigation.find((item) => item.id === view)?.label || "Settings";

  async function changeOrder(value) {
    const nextOrder = Number(value);
    if (Number.isInteger(nextOrder) && nextOrder >= 1 && nextOrder <= 6) setOrder(nextOrder);
  }

  async function handleLogin(event) {
    event.preventDefault();
    setLoginBusy(true);
    setLoginError("");
    const form = new FormData(event.currentTarget);
    try {
      const result = await api("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: form.get("email"), password: form.get("password") }),
      });
      sessionStorage.setItem("daybook-hod-token", result.access_token);
      const signedInHod = { name: result.hod_name, email: result.email, role: "HOD" };
      sessionStorage.setItem("daybook-hod-name", result.hod_name);
      sessionStorage.setItem("daybook-hod-email", result.email);
      setHod(signedInHod);
      setToken(result.access_token);
    } catch (requestError) {
      setLoginError(requestError.message);
    } finally {
      setLoginBusy(false);
    }
  }

  function signOut() {
    sessionStorage.removeItem("daybook-hod-token");
    sessionStorage.removeItem("daybook-hod-name");
    sessionStorage.removeItem("daybook-hod-email");
    pageHistory.current = [];
    setCanGoBack(false);
    setToken(null);
    setHod(null);
    setView("overview");
  }

  function openPeriodEditor(period, selectedCohort, selectedOrder) {
    setCohort(selectedCohort);
    setOrder(selectedOrder);
    setEditingPeriod(period || null);
    setModal("period");
  }

  async function changeCohort(nextCohort) {
    setCohort(nextCohort);
  }

  async function saveSettings(event) {
    event.preventDefault();
    setBusy(true);
    try {
      const form = new FormData(event.currentTarget);
      const applyOrderToday = event.nativeEvent.submitter?.value === "today";
      const updated = await api("/settings", {
        method: "PUT",
        body: JSON.stringify({
          college_name: form.get("college_name"),
          anchor_date: applyOrderToday ? todayInCollegeTimezone() : form.get("anchor_date"),
          anchor_day_order: Number(form.get("anchor_day_order")),
          reminder_time: form.get("reminder_time"),
          reminder_enabled: form.get("reminder_enabled") === "on",
        }),
      });
      setSettings(updated);
      setOrder(updated.current_day_order);
      setCurrentOrder(updated.current_day_order);
      setToast("Settings saved to the database.");
      setView("overview");
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  async function saveProfile(event) {
    event.preventDefault();
    setBusy(true);
    try {
      const form = new FormData(event.currentTarget);
      const updated = await api("/auth/profile", {
        method: "PUT",
        body: JSON.stringify({
          name: form.get("name"),
          email: form.get("email"),
        }),
      });
      const updatedHod = { name: updated.hod_name, email: updated.email, role: "HOD" };
      sessionStorage.setItem("daybook-hod-token", updated.access_token);
      sessionStorage.setItem("daybook-hod-name", updated.hod_name);
      sessionStorage.setItem("daybook-hod-email", updated.email);
      setToken(updated.access_token);
      setHod(updatedHod);
      setToast("Profile updated.");
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  async function changePassword(event) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const newPassword = form.get("new_password");
    if (newPassword !== form.get("confirm_password")) {
      setError("New password and confirmation do not match.");
      return;
    }
    setBusy(true);
    try {
      await api("/auth/change-password", {
        method: "POST",
        body: JSON.stringify({
          current_password: form.get("current_password"),
          new_password: newPassword,
        }),
      });
      formElement.reset();
      setToast("Password changed successfully.");
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  async function updateReminderEnabled(enabled) {
    try {
      const updated = await api("/settings", {
        method: "PUT",
        body: JSON.stringify({ ...settings, reminder_enabled: enabled }),
      });
      setSettings(updated);
      setAutomation(await api("/messages/automation"));
      setToast(enabled ? "Daily email schedule enabled." : "Daily email schedule paused.");
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  async function createPreview() {
    setBusy(true);
    try {
      const result = await api("/messages/preview", {
        method: "POST",
        body: JSON.stringify({ day_order: order, cohort }),
      });
      setToast(result.delivery_note);
      await loadData(order);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  async function sendCustomMessage() {
    if (!automation.custom_ready || customRecipients.length === 0 || !customSubject.trim()) return;
    const audienceLabel = customAudience === "students" ? `${customCohort} students` : "faculty";
    const confirmation = `Send this email now to ${customRecipients.length} eligible ${audienceLabel}?`;
    if (!window.confirm(confirmation)) return;
    setCustomBusy(true);
    try {
      const result = await api("/messages/custom", {
        method: "POST",
        body: JSON.stringify({
          audience: customAudience,
          cohort: customAudience === "students" ? customCohort : null,
          subject: customSubject.trim(),
          message: customMessage.trim(),
        }),
      });
      setMessages(await api("/messages"));
      setToast(
        result.status === "no_recipients"
          ? "No active, email-enabled recipients were available."
          : result.failed_count && result.sent_count === 0
            ? `Gmail could not deliver to ${result.failed_count} recipients. ${result.delivery_note || "Check message history for details."}`
            : `Gmail sent to ${result.sent_count} of ${result.recipient_count} recipients${result.failed_count ? `; ${result.failed_count} failed` : ""}.${result.delivery_note ? ` ${result.delivery_note}` : ""}`,
      );
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setCustomBusy(false);
    }
  }

  async function updatePersonEmailStatus(person) {
    const enable = !person.email_opt_in;
    if (enable && !window.confirm(`Enable timetable emails to ${person.email}?`)) return;
    try {
      await api(`/people/${person.id}`, {
        method: "PUT",
        body: JSON.stringify({
          name: person.name,
          role: person.role,
          group_name: person.group_name,
          email: person.email,
          email_opt_in: enable,
        }),
      });
      setPeople(await api("/people"));
      setToast(enable ? "Timetable emails enabled for this contact." : "Timetable emails paused for this contact.");
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  async function importRoster(event) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    setImportBusy(true);
    try {
      const contacts = parseRosterCsv(await file.text());
      if (contacts.length > 500) throw new Error("Upload up to 500 contacts at a time.");
      const result = await api("/people/bulk-import", {
        method: "POST",
        body: JSON.stringify({ contacts }),
      });
      setPeople(await api("/people"));
      setToast(`Roster imported: ${result.created} added, ${result.updated} updated, ${result.skipped} duplicate rows skipped.`);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setImportBusy(false);
    }
  }

  function downloadRosterTemplate() {
    const csv = "name,email,role,group_name\nAditi Sharma,aditi@example.edu,Student,AMCA\nDr. Meera Nair,meera@example.edu,Teacher,Computer Science\n";
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "daybook-email-roster-template.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  function openPersonEditor(person = null) {
    setEditingPerson(person);
    setPersonRole(person?.role || "Student");
    setModal("person");
  }

  async function deletePerson(person) {
    if (!window.confirm(`Delete ${person.name} from the people directory?${person.role === "Teacher" ? " Their timetable assignments will be set to Unassigned." : ""}`)) return;
    setBusy(true);
    try {
      await api(`/people/${person.id}`, { method: "DELETE" });
      setPeople(await api("/people"));
      setToast(`${person.name} removed from the directory.`);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  async function submitModal(event) {
    event.preventDefault();
    setBusy(true);
    const formData = new FormData(event.currentTarget);
    try {
      if (modal === "period") {
        const periodOrder = Number(formData.get("day_order"));
        const periodCohort = String(formData.get("cohort"));
        await api(
          `/day-orders/${periodOrder}/periods${editingPeriod ? `/${editingPeriod.id}` : ""}`,
          {
          method: editingPeriod ? "PUT" : "POST",
          body: JSON.stringify({
            cohort: periodCohort,
            period_number: Number(formData.get("period_number")),
            duration_hours: Number(formData.get("duration_hours")),
            subject: formData.get("subject"),
            class_name: formData.get("class_name"),
            teacher_name: formData.get("teacher_name"),
            room: formData.get("room"),
          }),
          },
        );
        await loadData(periodOrder);
        setCohort(periodCohort);
        setToast(editingPeriod ? "Timetable entry updated." : "Timetable entry added.");
      } else {
        const role = String(formData.get("role"));
        await api(editingPerson ? `/people/${editingPerson.id}` : "/people", {
          method: editingPerson ? "PUT" : "POST",
          body: JSON.stringify({
            name: formData.get("name"),
            role,
            group_name: role === "Student" ? formData.get("cohort") : formData.get("group_name"),
            email: formData.get("email"),
            email_opt_in: formData.get("email_opt_in") === "on",
          }),
        });
        setPeople(await api("/people"));
        setToast(editingPerson ? "Person details updated." : "Person added to the email directory.");
      }
      setModal("");
      setEditingPeriod(null);
      setEditingPerson(null);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  async function deletePeriod() {
    if (!editingPeriod) return;
    setBusy(true);
    try {
      await api(`/day-orders/${editingPeriod.day_order}/periods/${editingPeriod.id}`, {
        method: "DELETE",
      });
      await loadData(editingPeriod.day_order);
      setCohort(editingPeriod.cohort);
      setModal("");
      setEditingPeriod(null);
      setToast("Timetable entry deleted.");
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  function navigate(nextView) {
    if (nextView !== view) {
      pageHistory.current.push(view);
      setCanGoBack(true);
    }
    setView(nextView);
    setMobileMenu(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function navigateBack() {
    const previousView = pageHistory.current.pop();
    if (!previousView) return;
    setView(previousView);
    setCanGoBack(pageHistory.current.length > 0);
    setMobileMenu(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const periodLabel = (period) => {
    const lastHour = period.period_number + period.duration_hours - 1;
    return `Hour ${period.period_number}${lastHour > period.period_number ? `–${lastHour}` : ""}`;
  };
  const messagePeriodLabel = (period) => {
    const lastHour = period.period_number + period.duration_hours - 1;
    return `${period.period_number}${lastHour > period.period_number ? `-${lastHour}` : ""} Hr`;
  };
  const studentPreview = schedule
    .map((period) => `${messagePeriodLabel(period)} ${period.subject}`).join("; ");
  const teacherPreview = [...cohorts.flatMap((item) => schedules[item][order - 1] || [])
    .reduce((assignments, period) => {
    const classes = assignments.get(period.teacher_name) || [];
    classes.push(`${period.cohort} ${messagePeriodLabel(period)} ${period.subject} (${period.room})`);
    assignments.set(period.teacher_name, classes);
    return assignments;
  }, new Map())]
    .map(([teacher, classes]) => `Good morning, ${teacher}. Your classes: ${classes.join("; ")}.`)
    .join(" ");

  if (!token || !hod) {
    return <LoginScreen onSubmit={handleLogin} busy={loginBusy} error={loginError} />;
  }

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileMenu ? "mobile-open" : ""}`}>
        <a className="brand" href="#" onClick={(event) => { event.preventDefault(); navigate("overview"); }}>
          <span className="brand-mark"><CalendarDays size={19} /></span><span className="brand-name">daybook<span>.</span></span>
        </a>
        <div className="campus-switch"><span className="campus-avatar">NC</span><span className="campus-copy"><strong>{settings.college_name}</strong><small>Campus admin</small></span><span className="switch-dots">•••</span></div>
        <span className="nav-label">WORKSPACE</span>
        <nav className="main-nav" aria-label="Main navigation">
          {navigation.map(({ id, label, Icon }) => <button key={id} className={`nav-item ${view === id ? "active" : ""}`} onClick={() => navigate(id)}><Icon size={17} /><span>{label}</span>{id === "timetable" && <span className="nav-count">6</span>}</button>)}
        </nav>
        <div className="sidebar-bottom">
          <div className="help-card"><span className="help-icon"><Sparkles size={15} /></span><strong>Make mornings easier</strong><p>Set up daily timetable reminders for your campus.</p><button className="text-button" onClick={() => navigate("messages")}>Explore messages <span>→</span></button></div>
          <button className={`nav-item settings-link ${view === "settings" ? "active" : ""}`} onClick={() => navigate("settings")}><Settings2 size={17} /><span>Settings</span></button>
          <div className="profile-row"><span className="profile-avatar">{initials(hod.name)}</span><span className="profile-copy"><strong>{hod.name}</strong><small>Department HOD</small></span><button className="profile-menu logout-button" onClick={signOut}>Log out</button></div>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <button className="icon-button mobile-menu" aria-label="Toggle menu" onClick={() => setMobileMenu(!mobileMenu)}><Menu size={17} /></button>
          <button className="previous-button" onClick={navigateBack} disabled={!canGoBack} aria-label="Go to previous page" title={canGoBack ? "Go to previous page" : "No previous page"}><ArrowLeft size={15} /><span>Back</span></button>
          <button className={`home-button ${view === "overview" ? "home-button-active" : ""}`} onClick={() => navigate("overview")} aria-label="Go to home" aria-current={view === "overview" ? "page" : undefined}><House size={15} /><span>Home</span></button>
          <div className="breadcrumbs"><span>Workspace</span><ChevronRight size={13} /><strong>{title}</strong></div>
          <div className="topbar-right"><span className="today-label">{date}</span><span className="top-avatar">{initials(hod.name)}</span></div>
        </header>

        <div className="content">
          {error && <div className="error-banner" role="alert"><strong>Could not complete the request.</strong> {error} <button className="error-retry" onClick={() => loadData()} disabled={busy}>Retry loading</button><button onClick={() => setError("")} aria-label="Dismiss error"><X size={15} /></button></div>}
          {view === "overview" && <section className="view">
            <div className="welcome-row"><div><div className="eyebrow"><span className="live-dot" /> HOD WORKSPACE</div><h1>Good morning, {hod.name.split(" ")[0]} <span className="wave">✦</span></h1><p className="page-subtitle">Your MCA timetable overview. Today is automatically Day Order {String(currentOrder).padStart(2, "0")}.</p></div><button className="button button-primary" onClick={() => navigate("settings")}><Settings2 size={15} /> Cycle settings</button></div>
            <div className="today-banner"><div className="banner-main"><span className="banner-icon"><CalendarDays size={22} /></span><div><div className="banner-kicker">TODAY'S SCHEDULE</div><h2>Day Order {String(currentOrder).padStart(2, "0")} <span className="banner-badge">Today</span></h2><p>{scheduledHours} timetable hours for the selected cohort.</p></div></div><div className="banner-current">Cycle advances automatically</div><div className="banner-decoration" /></div>
            <div className="stats-grid">
              <StatCard Icon={BookOpen} tone="lavender" value={scheduledHours} suffix="hours" caption="Timetable hours in this order" note="Across 6 day orders" />
              <StatCard Icon={Users} tone="mint" value={students.length} caption="Active students" note={`${verifiedStudents} email-enabled contacts`} />
              <StatCard Icon={MessageCircle} tone="peach" value={teachers.length} suffix="teachers" caption="Faculty in directory" note={`${verifiedTeachers} email-enabled contacts`} />
            </div>
            <div className="dashboard-grid">
              <section className="panel schedule-panel"><div className="panel-heading"><div><div className="section-kicker">TIMETABLES</div><h3>Choose a schedule</h3></div><span className="status-pill"><span className="live-dot" />Day {order}</span></div><div className="timetable-cards"><button className="timetable-card student-card" onClick={() => navigate("student")}><span className="timetable-card-icon"><Users size={20} /></span><span className="timetable-card-copy"><strong>Student timetable</strong><small>Manage AMCA and NMCA schedules</small><span className="cohort-badges"><b>AMCA · 1st year</b><b>NMCA · 2nd year</b></span></span><ChevronRight size={17} /></button><button className="timetable-card faculty-card" onClick={() => navigate("faculty")}><span className="timetable-card-icon"><BookOpen size={20} /></span><span className="timetable-card-copy"><strong>Faculty timetable</strong><small>View teachers' classes by day and hour</small><span className="cohort-badges"><b>{teachers.length} faculty</b><b>Day Order {order}</b></span></span><ChevronRight size={17} /></button></div><div className="schedule-footer"><span><span className="legend-dot" />Six-hour day-order rotation</span></div></section>
              <aside className="right-column"><section className="panel automation-panel"><div className="panel-heading"><div><div className="section-kicker">AUTOMATION</div><h3>Morning updates</h3></div><span className={`status-pill ${automation.daily_ready && settings.reminder_enabled ? "" : "paused"}`}><span className="live-dot" />{automationLabel}</span></div><p className="panel-description">Automatic student and teacher emails at the scheduled time in India Standard Time.</p><div className="automation-row"><span className="automation-icon"><Clock3 size={16} /></span><div className="automation-copy"><strong>Daily timetable email</strong><small>Daily at 7:00 AM IST</small></div><label className="toggle"><input type="checkbox" checked={Boolean(automation.daily_enabled && settings.reminder_enabled)} disabled={!automation.daily_enabled} onChange={(event) => updateReminderEnabled(event.target.checked)} aria-label="Enable daily reminder" /><span /></label></div>{automation.last_run && <div className="automation-last-run">Latest: Day {automation.last_run.day_order} · {automation.last_run.sent_count}/{automation.last_run.recipient_count} sent{automation.last_run.failed_count ? ` · ${automation.last_run.failed_count} failed` : ""}</div>}<button className="button button-light button-full" onClick={() => navigate("messages")}>Review message <ChevronRight size={14} /></button></section>
                <section className="panel quick-message"><div className="panel-heading"><div><div className="section-kicker">QUICK ACTION</div><h3>Send an update</h3></div><span className="quick-sparkle"><Send size={15} /></span></div><p className="panel-description">Generate a one-time message preview.</p><div className="recipient-chips"><span className="recipient-chip"><span className="mini-avatar student">S</span> Students <strong>{students.length}</strong></span><span className="recipient-chip"><span className="mini-avatar teacher">T</span> Teachers <strong>{teachers.length}</strong></span></div><button className="button button-dark button-full" onClick={() => navigate("messages")}><Send size={14} /> Compose a message</button></section></aside>
            </div>
            <footer className="page-footer"><span>Registered Web Application · 2026</span><span>DAYBOOK <span className="footer-dot">•</span> 2026</span></footer>
          </section>}

          {view === "student" && <section className="view"><div className="welcome-row"><div><div className="eyebrow">STUDENT TIMETABLE</div><h1>MCA student schedule</h1><p className="page-subtitle">Separate six-day rotations for first-year AMCA and second-year NMCA.</p></div><button className="button button-primary" onClick={() => openPeriodEditor(null, cohort, order)}><Plus size={15} /> Add entry</button></div><div className="cohort-switcher" role="tablist" aria-label="MCA year"><button className={cohort === "AMCA" ? "active" : ""} role="tab" aria-selected={cohort === "AMCA"} onClick={() => changeCohort("AMCA")}><strong>AMCA</strong><span>1st year</span></button><button className={cohort === "NMCA" ? "active" : ""} role="tab" aria-selected={cohort === "NMCA"} onClick={() => changeCohort("NMCA")}><strong>NMCA</strong><span>2nd year</span></button></div><section className="panel matrix-panel"><div className="panel-heading"><div><div className="section-kicker">{cohort} · {cohort === "AMCA" ? "FIRST YEAR" : "SECOND YEAR"}</div><h3>Six-day order timetable</h3></div><span className="status-pill"><span className="live-dot" />Today: Day {currentOrder}</span></div><p className="matrix-help">Select a cell to edit it. Use the + at the end of a row to add an entry.</p><div className="table-wrap matrix-wrap"><table className="timetable-matrix"><thead><tr><th>DAY</th>{[1, 2, 3, 4, 5, 6].map((hour) => <th key={hour}>{hour} Hr</th>)}</tr></thead><tbody>{dayOrders.map((day) => <MatrixRow key={day} order={day} schedule={schedules[cohort][day - 1] || []} active={currentOrder === day} onSelect={() => changeOrder(day)} onAdd={() => openPeriodEditor(null, cohort, day)} onEdit={(period) => openPeriodEditor(period, cohort, day)} />)}</tbody></table></div></section><div className="info-note"><span className="note-icon">i</span><span>Lab entries span their full hour range. Edits here affect only {cohort}; the other year's timetable remains separate.</span></div></section>}

          {view === "faculty" && <section className="view"><div className="welcome-row"><div><div className="eyebrow">FACULTY TIMETABLE</div><h1>Faculty schedule</h1><p className="page-subtitle">Teacher assignments from both AMCA and NMCA for every day order.</p></div></div><section className="panel matrix-panel"><div className="panel-heading"><div><div className="section-kicker">ALL MCA FACULTY</div><h3>Classes by day and hour</h3></div><span className="status-pill"><span className="live-dot" />Today: Day {currentOrder}</span></div><p className="matrix-help">Use the Edit control on an assignment to change its teacher, class, subject, or room.</p><div className="table-wrap matrix-wrap"><table className="timetable-matrix faculty-matrix"><thead><tr><th>DAY</th>{[1, 2, 3, 4, 5, 6].map((hour) => <th key={hour}>{hour} Hr</th>)}</tr></thead><tbody>{dayOrders.map((day) => <FacultyMatrixRow key={day} order={day} schedules={cohorts.map((item) => ({ cohort: item, periods: schedules[item][day - 1] || [] }))} active={currentOrder === day} onSelect={() => changeOrder(day)} onEdit={(period, item) => openPeriodEditor(period, item, day)} />)}</tbody></table></div></section><div className="info-note"><span className="note-icon">i</span><span>Faculty edits update only the selected class in its AMCA or NMCA schedule.</span></div></section>}

          {view === "people" && <section className="view"><div className="welcome-row"><div><div className="eyebrow">CAMPUS DIRECTORY</div><h1>Your people</h1><p className="page-subtitle">Manage email addresses and email delivery preferences for daily updates.</p></div><div className="directory-actions"><input ref={rosterFileInput} type="file" accept=".csv,text/csv" hidden onChange={importRoster} /><button className="button button-light" disabled={importBusy} onClick={downloadRosterTemplate}><Mail size={14} /> CSV template</button><button className="button button-light" disabled={importBusy} onClick={() => rosterFileInput.current?.click()}><Upload size={14} /> {importBusy ? "Importing..." : "Bulk upload Gmail"}</button><button className="button button-primary" onClick={() => openPersonEditor()}><Plus size={15} /> Add person</button></div></div><div className="people-summary"><PeopleStat Icon={Users} tone="mint" value={students.length} label="Students" /><PeopleStat Icon={BookOpen} tone="peach" value={teachers.length} label="Faculty members" /><PeopleStat Icon={Check} tone="verified" value={`${people.length ? Math.round((people.filter((person) => person.email_opt_in && !person.is_sample).length / people.length) * 100) : 0}%`} label="Email-enabled contacts" /></div><section className="panel people-panel"><div className="people-toolbar"><div className="people-tabs">{["Everyone", "Students", "Teachers"].map((item) => <button key={item} className={`people-tab ${filter === item ? "active" : ""}`} onClick={() => setFilter(item)}>{item}<span>{item === "Everyone" ? people.length : item === "Students" ? students.length : teachers.length}</span></button>)}</div><label className="search-box"><Search size={14} /><input value={search} onChange={(event) => setSearch(event.target.value)} type="search" placeholder="Search name or class..." /></label></div><div className="table-wrap"><table className="schedule-table people-table"><thead><tr><th>NAME</th><th>ROLE</th><th>CLASS / DEPARTMENT</th><th>GMAIL ADDRESS</th><th>EMAIL STATUS</th><th>ACTIONS</th></tr></thead><tbody>{activePeople.length ? activePeople.map((person) => <tr key={person.id}><td><span className="person-name"><span className={`person-avatar ${person.role === "Teacher" ? "teacher-color" : ""}`}>{initials(person.name)}</span><strong>{person.name}</strong></span></td><td><span className={`role-pill ${person.role === "Teacher" ? "teacher-role" : ""}`}>{person.role}</span></td><td>{person.group_name}</td><td>{person.is_sample ? "Demo contact" : person.email}</td><td><div className="email-contact-status"><span className={person.is_sample || !person.email_opt_in ? "unverified-status" : "verified-status"}>{person.is_sample ? "Demo contact" : person.email_opt_in ? "Email enabled" : "Email paused"}</span>{!person.is_sample && <button type="button" className="email-toggle-button" onClick={() => updatePersonEmailStatus(person)}>{person.email_opt_in ? "Pause email" : "Enable email"}</button>}</div></td><td><div className="people-actions"><button type="button" className="text-button" onClick={() => openPersonEditor(person)}><Pencil size={12} /> Edit</button><button type="button" className="text-button people-delete" disabled={busy} onClick={() => deletePerson(person)}><X size={12} /> Delete</button></div></td></tr>) : <tr><td colSpan="6" className="no-results">No matching people found.</td></tr>}</tbody></table></div></section></section>}

          {view === "messages" && <section className="view">
            <div className="welcome-row"><div><div className="eyebrow">CAMPUS COMMUNICATION</div><h1>Morning messages</h1><p className="page-subtitle">Send one-time updates separately to students or faculty, or review the daily timetable reminders.</p></div><button className="button button-primary" disabled={busy} onClick={createPreview}><Send size={14} /> Generate preview</button></div>
            <section className="panel custom-message-panel">
              <div className="panel-heading"><div><div className="section-kicker">CUSTOM EMAIL</div><h3>Write a custom message</h3></div><span className={`status-pill ${automation.custom_ready ? "" : "paused"}`}><span className="live-dot" />{automation.custom_ready ? "Ready to send" : "Sending unavailable"}</span></div>
              <p className="panel-description">Choose one audience. Only active, non-demo contacts with email enabled are included.</p>
              <div className="custom-audience-picker" role="group" aria-label="Custom message audience">
                <button type="button" className={customAudience === "students" ? "active" : ""} onClick={() => setCustomAudience("students")}><Users size={14} /> Students</button>
                <button type="button" className={customAudience === "faculty" ? "active" : ""} onClick={() => setCustomAudience("faculty")}><BookOpen size={14} /> Faculty</button>
              </div>
              {customAudience === "students" && <label className="custom-cohort-picker">Student year<select value={customCohort} onChange={(event) => setCustomCohort(event.target.value)}><option value="AMCA">AMCA · 1st year</option><option value="NMCA">NMCA · 2nd year</option></select></label>}
              <label className="custom-message-label">Subject<input value={customSubject} onChange={(event) => setCustomSubject(event.target.value)} maxLength={200} placeholder="e.g. Day Order timetable update" /></label>
              <label className="custom-message-label">Message<textarea value={customMessage} onChange={(event) => setCustomMessage(event.target.value)} maxLength={10000} rows={4} placeholder="Write an announcement for the selected audience…" /></label>
              <div className="custom-message-footer"><span>{customRecipients.length} email-enabled contact{customRecipients.length === 1 ? "" : "s"}{customRecipients.length > 100 ? " · limit is 100 per send" : ""}</span><button className="button button-dark" type="button" disabled={!automation.custom_ready || customBusy || customRecipients.length === 0 || customRecipients.length > 100 || !customSubject.trim() || !customMessage.trim()} onClick={sendCustomMessage}><Send size={14} />{customBusy ? "Sending…" : automation.custom_ready ? `Send custom email to ${customAudience === "students" ? customCohort : "faculty"}` : "Sending unavailable"}</button></div>

            </section>
            <div className="message-layout"><section className="panel message-setup"><div className="panel-heading"><div><div className="section-kicker">TIMETABLE EMAILS</div><h3>Morning timetable email</h3></div><span className={`status-pill ${automation.daily_ready && settings.reminder_enabled ? "" : "paused"}`}><span className="live-dot" />{!automation.daily_enabled ? "Not configured" : settings.reminder_enabled && automation.daily_ready ? "Enabled" : "Paused"}</span></div><p className="panel-description">Personalized timetable emails are scheduled each morning at 7:00 AM India Standard Time.</p><div className="message-schedule-card"><span className="automation-icon"><Clock3 size={16} /></span><div><strong>Scheduled for 7:00 AM IST</strong><small>Daily · Asia/Kolkata</small></div><button className="text-button" onClick={() => navigate("settings")}>Edit settings</button></div><div className="message-cohort-picker"><span>Student reminder for</span>{cohorts.map((item) => <button key={item} className={cohort === item ? "active" : ""} onClick={() => changeCohort(item)}>{item}</button>)}</div><div className="template-heading"><div><strong>{cohort} student email preview</strong><span>Day Order {String(order).padStart(2, "0")} · {cohort === "AMCA" ? "1st year" : "2nd year"}</span></div><span className="preview-tag">PREVIEW</span></div><div className="email-preview"><strong>Good morning!</strong> {cohort} students, today is Day Order {String(order).padStart(2, "0")}. Your classes: {studentPreview || "No classes configured yet."}. Have a great day!</div><div className="template-heading teacher-template-heading"><div><strong>Teacher email preview</strong><span>Individual classes across AMCA and NMCA</span></div></div><div className="email-preview teacher-preview">{teacherPreview || "No classes configured yet."}</div><div className="message-actions"><span className="demo-hint">Preview only · No emails sent</span><button className="button button-dark" disabled={busy} onClick={createPreview}><Send size={14} /> Save preview to history</button></div></section>
              <aside className="panel message-info"><div className="section-kicker">RECIPIENTS</div><h3>Who gets notified?</h3><AudienceRow role="Student" count={verifiedStudentsByCohort[cohort]} detail={`${cohort} · email-enabled ${cohort === "AMCA" ? "1st year" : "2nd year"} students`} /><AudienceRow role="Teacher" count={verifiedScheduledTeachers} detail="Email-enabled faculty assigned classes on this day order" /></aside></div>
            <section className="panel activity-panel"><div className="panel-heading"><div><div className="section-kicker">RECENT ACTIVITY</div><h3>Message history</h3></div><span className="demo-hint">Custom sends and saved previews</span></div>{messages.length ? <div className="activity-list">{messages.map((message) => { const body = message.audience === "faculty" ? message.teacher_message : message.student_message; const audienceLabel = message.audience === "students" ? `${message.cohort} students` : message.audience === "faculty" ? "Faculty" : message.audience === "daily" ? "Daily timetable email" : `${message.cohort} timetable preview`; return <div key={message.id} className={`activity-item ${message.status === "failed" || message.status === "partial" ? "activity-item-failed" : ""}`}><span className="empty-icon"><Check size={15} /></span><span className="activity-copy"><strong>{audienceLabel} · {message.status === "preview" ? `Day Order ${String(message.day_order).padStart(2, "0")}` : message.status}</strong><small>{message.status === "preview" ? "Preview only - No email sent" : `\${message.sent_count} sent of \${message.recipient_count} recipients ? \${message.failed_count} failed`}</small>{body && <p>{body}</p>}</span><span className="activity-time">{new Date(`${message.created_at}Z`).toLocaleString()}</span></div>; })}</div> : <div className="empty-activity"><span className="empty-icon"><MessageCircle size={15} /></span><span><strong>No message activity yet</strong><small>Generate a timetable preview to add activity.</small></span></div>}</section>
          </section>}

          {view === "profile" && <section className="view">
            <div className="welcome-row"><div><div className="eyebrow">ACCOUNT</div><h1>Your profile</h1><p className="page-subtitle">Update your name, sign-in email, and password.</p></div></div>
            <form className="panel settings-panel profile-panel" onSubmit={saveProfile}>
              <div className="panel-heading"><div><div className="section-kicker">PROFILE DETAILS</div><h3>Personal information</h3></div><span className="profile-avatar">{initials(hod.name)}</span></div>
              <div className="profile-fields">
                <label>Display name<input name="name" type="text" defaultValue={hod.name} autoComplete="name" minLength="2" maxLength="100" required /></label>
                <label>Sign-in username (email)<input name="email" type="email" defaultValue={hod.email} autoComplete="username" maxLength="254" required /></label>
              </div>
              <div className="settings-footer"><span className="demo-hint">Your sign-in email is your username.</span><button className="button button-primary" disabled={busy}><Check size={15} /> Save profile</button></div>
            </form>
            <form className="panel settings-panel profile-panel" onSubmit={changePassword}>
              <div className="panel-heading"><div><div className="section-kicker">SECURITY</div><h3>Change password</h3></div></div>
              <div className="profile-fields">
                <PasswordField label="Current password" name="current_password" autoComplete="current-password" />
                <PasswordField label="New password" name="new_password" autoComplete="new-password" />
                <PasswordField label="Confirm new password" name="confirm_password" autoComplete="new-password" />
              </div>
              <p className="settings-explanation">Enter your new password and confirm it to make the change.</p>
              <div className="settings-footer"><span className="demo-hint">Your current password is required to make this change.</span><button className="button button-primary" disabled={busy}><Check size={15} /> Update password</button></div>
            </form>
          </section>}

          {view === "settings" && <section className="view"><div className="welcome-row"><div><div className="eyebrow">HOD PREFERENCES</div><h1>Settings</h1><p className="page-subtitle">Configure the automatic six-day rotation and morning reminder.</p></div></div><form className="panel settings-panel" onSubmit={saveSettings}><div className="panel-heading"><div><div className="section-kicker">CAMPUS &amp; DAY-ORDER CYCLE</div><h3>Automatic schedule settings</h3></div><span className="status-pill"><span className="live-dot" />Today: Day {currentOrder}</span></div><div className="settings-grid"><label>College name<input name="college_name" defaultValue={settings.college_name} required minLength="2" /></label><label>Campus timezone<input value="India Standard Time (IST)" readOnly /></label><label>Cycle start date<input name="anchor_date" type="date" defaultValue={settings.anchor_date} required /></label><label>Day order on that date<select name="anchor_day_order" defaultValue={settings.anchor_day_order}>{dayOrders.map((day) => <option key={day} value={day}>Day Order {day}</option>)}</select></label><label>Morning email time<input name="reminder_time" type="time" value="07:00" readOnly /></label></div><p className="settings-explanation">Home shows the day order calculated for today from this start date. Use “Set selected order for today” to start the chosen order today; regular Save keeps the selected start date.</p><label className="settings-toggle"><input type="checkbox" name="reminder_enabled" checked={Boolean(automation.daily_enabled && settings.reminder_enabled)} disabled={!automation.daily_enabled} onChange={(event) => updateReminderEnabled(event.target.checked)} /> Enable the daily reminder schedule</label><div className="settings-footer"><span className="demo-hint">Changes save to the SQL database.</span><div className="settings-actions"><button className="button button-light" type="submit" name="cycle_action" value="today" disabled={busy}>Set selected order for today</button><button className="button button-primary" type="submit" disabled={busy}><Check size={15} /> Save changes</button></div></div></form><div className="info-note"><span className="note-icon">i</span><span>Rotation advances daily, including weekends. Timetable reminders are emailed at 7:00 AM IST when Gmail is configured.</span></div></section>}
        </div>
      </main>
      {toast && <div className="toast" role="status">{toast}</div>}
      {modal && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) { setModal(""); setEditingPeriod(null); setEditingPerson(null); } }}><form key={`${modal}-${editingPeriod?.id || editingPerson?.id || "new"}`} className="modal" onSubmit={submitModal}><button className="modal-close" type="button" onClick={() => { setModal(""); setEditingPeriod(null); setEditingPerson(null); }} aria-label="Close"><X size={18} /></button><span className="modal-symbol"><Sparkles size={20} /></span><h2>{modal === "period" ? `${editingPeriod ? "Edit" : "Add"} timetable entry` : `${editingPerson ? "Edit" : "Add"} a person`}</h2><p>{modal === "period" ? "Choose a course year, hour and duration. Labs can span multiple hours." : editingPerson ? "Update this person's directory details. Update the Gmail address used for timetable notices." : "New contacts are enabled for timetable emails by default. You can pause email delivery from the People list."}</p>{modal === "period" ? <div className="modal-fields"><label>Course year<select name="cohort" defaultValue={editingPeriod?.cohort || cohort}>{cohorts.map((item) => <option key={item} value={item}>{item} · {item === "AMCA" ? "1st year" : "2nd year"}</option>)}</select></label><label>Day order<select name="day_order" defaultValue={editingPeriod?.day_order || order}>{dayOrders.map((day) => <option key={day} value={day}>Day {day}</option>)}</select></label><label>Starting hour<select name="period_number" defaultValue={editingPeriod?.period_number || 1}>{[1, 2, 3, 4, 5, 6].map((hour) => <option key={hour} value={hour}>{hour} Hr</option>)}</select></label><label>Duration<select name="duration_hours" defaultValue={editingPeriod?.duration_hours || 1}>{[1, 2, 3, 4, 5, 6].map((hours) => <option key={hours} value={hours}>{hours} {hours === 1 ? "hour" : "hours"}</option>)}</select></label><label>Subject<input name="subject" defaultValue={editingPeriod?.subject || ""} placeholder="e.g. SE LAB" required /></label><label>Class<input name="class_name" defaultValue={editingPeriod?.class_name || cohort} required /></label><label>Teacher<select name="teacher_name" defaultValue={editingPeriod?.teacher_name || ""} required><option value="" disabled>Select a teacher</option>{editingPeriod?.teacher_name && !teachers.some((person) => person.name === editingPeriod.teacher_name) && <option value={editingPeriod.teacher_name}>{editingPeriod.teacher_name} · no longer in directory</option>}{teachers.map((teacher) => <option key={teacher.id} value={teacher.name}>{teacher.name}</option>)}<option value="Unassigned">Unassigned</option></select></label><label>Room<input name="room" defaultValue={editingPeriod?.room || ""} required /></label></div> : <div className="modal-fields"><label>Name<input name="name" defaultValue={editingPerson?.name || ""} minLength="2" required /></label><label>Role<select name="role" value={personRole} onChange={(event) => setPersonRole(event.target.value)}><option>Student</option><option>Teacher</option></select></label>{personRole === "Student" ? <label>Student cohort<select name="cohort" defaultValue={editingPerson?.role === "Student" ? editingPerson.group_name : "AMCA"} required><option value="AMCA">AMCA · 1st year</option><option value="NMCA">NMCA · 2nd year</option></select></label> : <label>Teacher department<input name="group_name" defaultValue={editingPerson?.role === "Teacher" ? editingPerson.group_name : "MCA"} required /></label>}<label>Gmail address<input name="email" type="email" defaultValue={editingPerson?.email || ""} maxLength="254" placeholder="student@gmail.com" required /></label><label className="settings-toggle"><input type="checkbox" name="email_opt_in" defaultChecked={editingPerson ? editingPerson.email_opt_in : true} /> Enable timetable emails</label></div>}{modal === "period" && editingPeriod && <button className="button button-danger button-full" type="button" disabled={busy} onClick={deletePeriod}>Delete timetable entry</button>}<button className="button button-dark button-full" disabled={busy}>{busy ? "Saving…" : modal === "period" && editingPeriod ? "Save timetable changes" : modal === "person" && editingPerson ? "Save person changes" : "Save to database"}</button></form></div>}
    </div>
  );
}

function StatCard({ Icon, tone, value, suffix, caption, note }) {
  return <article className="stat-card"><div className="stat-top"><span className={`stat-icon ${tone}`}><Icon size={16} /></span><span className="stat-change">{note}</span></div><div className="stat-value">{value} {suffix && <span>{suffix}</span>}</div><div className="stat-caption">{caption}</div></article>;
}

function PeopleStat({ Icon, tone, value, label }) {
  return <div className="people-stat"><span className={tone === "verified" ? "verified-mark" : `stat-icon ${tone}`}><Icon size={16} /></span><div><strong>{value}</strong><small>{label}</small></div></div>;
}

function ScheduleTable({ schedule, compact = false }) {
  return <div className="table-wrap"><table className="schedule-table"><thead><tr><th>HOUR</th><th>SUBJECT</th><th>CLASS</th><th>FACULTY</th><th>ROOM</th></tr></thead><tbody>{schedule.length ? schedule.map((period) => <tr key={period.id}><td>{periodLabel(period)}</td><td><span className="subject-cell"><span className="subject-mark">{initials(period.subject)}</span>{period.subject}</span></td><td>{period.class_name}</td><td>{period.teacher_name}</td><td>{period.room}</td></tr>) : <tr><td colSpan="5" className="no-results">No periods configured for this day order.</td></tr>}</tbody></table></div>;
}

function periodLabel(period) {
  const endHour = period.period_number + period.duration_hours - 1;
  return endHour > period.period_number ? `${period.period_number}–${endHour} Hr` : `${period.period_number} Hr`;
}

function MatrixRow({ order, schedule, active, onSelect, onAdd, onEdit }) {
  const cells = [];
  let hour = 1;
  while (hour <= 6) {
    const entry = schedule.find((period) => period.period_number === hour);
    if (entry) {
      cells.push(<td key={hour} colSpan={entry.duration_hours} className={entry.subject.trim().toUpperCase().endsWith("LAB") ? "matrix-subject lab-cell" : "matrix-subject"}><button className="matrix-entry-button" onClick={() => onEdit(entry)} title={`Edit ${entry.subject}, hours ${entry.period_number} to ${entry.period_number + entry.duration_hours - 1}`}><strong>{entry.subject}</strong><span>Edit</span></button></td>);
      hour += entry.duration_hours;
    } else {
      const covered = schedule.some((period) => period.period_number < hour && period.period_number + period.duration_hours > hour);
      if (!covered) cells.push(<td key={hour} className="empty-hour" />);
      hour += 1;
    }
  }
  return <tr className={active ? "current-day" : ""}><th scope="row"><button className="day-order-button" onClick={onSelect}>Day {order}</button><button className="row-add-button" onClick={onAdd} aria-label={`Add entry to day ${order}`}><Plus size={13} /></button></th>{cells}</tr>;
}

function FacultyMatrixRow({ order, schedules, active, onSelect, onEdit }) {
  const cells = [1, 2, 3, 4, 5, 6].map((hour) => {
    const assignments = schedules.flatMap(({ cohort, periods }) => periods
      .filter((period) => period.period_number <= hour && period.period_number + period.duration_hours > hour)
      .map((period) => ({ cohort, period })));
    return <td key={hour} className="faculty-hour-cell">{assignments.length ? assignments.map(({ cohort, period }) => <button key={`${cohort}-${period.id}`} className={`faculty-assignment ${cohort.toLowerCase()}`} title={`Edit ${cohort} · ${period.teacher_name} · ${period.subject}`} onClick={() => onEdit(period, cohort)}><span>{cohort}</span><strong>{period.teacher_name}</strong><small>{period.subject}</small><span className="faculty-edit-label"><Pencil size={9} /> Edit</span></button>) : <span className="faculty-empty">—</span>}</td>;
  });
  return <tr className={active ? "current-day" : ""}><th scope="row"><button className="day-order-button" onClick={onSelect}>Day {order}</button></th>{cells}</tr>;
}

function AudienceRow({ role, count, detail }) {
  return <div className="audience-row"><span className={`mini-avatar ${role === "Student" ? "student" : "teacher"}`}>{role[0]}</span><div><strong>{role === "Student" ? "Students" : "Teachers"}</strong><small>{detail}</small></div><b>{count}</b></div>;
}

function LoginScreen({ onSubmit, busy, error }) {
  return <main className="login-page"><div className="login-decoration decoration-one" /><div className="login-decoration decoration-two" /><section className="login-card"><a className="brand login-brand" href="#"><span className="brand-mark"><CalendarDays size={19} /></span><span className="brand-name">daybook<span>.</span></span></a><div className="login-heading"><span className="login-badge"><Settings2 size={18} /></span><div className="eyebrow">Day Order Remainder</div><h1>Sign in</h1></div><form onSubmit={onSubmit} className="login-form"><label>Email address<input name="email" type="email" autoComplete="username" placeholder="hod@college.edu" required /></label><PasswordField label="Password" name="password" autoComplete="current-password" placeholder="Enter your password" />{error && <div className="login-error" role="alert">{error}</div>}<button className="button button-primary button-full" disabled={busy}>{busy ? "Signing in..." : "Sign in"}<ChevronRight size={15} /></button></form></section></main>;
}

export default App;
